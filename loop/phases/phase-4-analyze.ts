#!/usr/bin/env bun
/**
 * Phase 4: Analyze
 * For each approach, spawn one reviewer agent that votes keep/drop/conditional.
 * Auto-drops approaches with status "error", "degraded", or regression_detected.
 * Runs 3 agents in parallel.
 * Writes vote JSONs to loop/iteration-N/analyze/
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnAgent } from "../lib/agent.ts";

const REPO_ROOT = "/Users/jack/mag/magus-bench";
const LOOP_DIR = join(REPO_ROOT, "loop");

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { iteration: number; dryRun: boolean } {
  let iteration = 1;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--iteration" && argv[i + 1]) {
      iteration = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { iteration, dryRun };
}

// ---------------------------------------------------------------------------
// Types (inline mirrors of lib/types.ts to avoid circular imports)
// ---------------------------------------------------------------------------

type ApproachLabel = "a" | "b" | "c";
type VoteValue = "keep" | "drop" | "conditional";
type Confidence = "high" | "medium" | "low";

interface ReviewerVote {
  approach: ApproachLabel;
  reviewer_agent: number;
  vote: VoteValue;
  confidence: Confidence;
  primary_metric_delta: string;
  secondary_signals: string[];
  concerns: string[];
  rationale: string;
  auto_dropped: boolean;
}

interface ApproachResult {
  approach: ApproachLabel;
  iteration: number;
  target_eval: string;
  status: "success" | "error" | "degraded";
  error: string | null;
  metrics: Record<string, unknown> | null;
  baseline_deltas: Record<string, number> | null;
  regression_detected: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readJSONOrNull(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Parse the reviewer agent output as JSON.
 * The agent is asked to output a JSON block; extract it from markdown if needed.
 */
function parseReviewerOutput(output: string, label: ApproachLabel): ReviewerVote {
  // Try to extract JSON from a fenced code block first
  const fenceMatch = output.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : output.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<ReviewerVote>;
    return {
      approach: label,
      reviewer_agent: 1,
      vote: (parsed.vote as VoteValue) ?? "drop",
      confidence: (parsed.confidence as Confidence) ?? "low",
      primary_metric_delta: parsed.primary_metric_delta ?? "unknown",
      secondary_signals: parsed.secondary_signals ?? [],
      concerns: parsed.concerns ?? [],
      rationale: parsed.rationale ?? output.slice(0, 500),
      auto_dropped: false,
    };
  } catch {
    // Could not parse JSON — treat as drop with explanation
    console.warn(`[phase-4] Could not parse reviewer JSON for approach ${label}, defaulting to drop`);
    return {
      approach: label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "low",
      primary_metric_delta: "unknown (parse error)",
      secondary_signals: [],
      concerns: [`Could not parse reviewer output: ${output.slice(0, 200)}`],
      rationale: `JSON parse failed. Raw output: ${output.slice(0, 500)}`,
      auto_dropped: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Decision protocol text (inlined from requirements section 6)
// ---------------------------------------------------------------------------

const DECISION_PROTOCOL_TEXT = `
## Decision Protocol

### tech-writer-eval
Keep vote criteria (at least one required):
- Borda delta (techwriter) >= +1
- Weighted score delta >= +0.1
- Friedman p decreases by >= 0.05
- Bootstrap CI narrows by >= 0.1

Veto criteria (any triggers mandatory drop):
- regression_detected: true
- Friedman p increases by > 0.10
- Any criterion mean drops below baseline - 0.8
- Successful judge count drops below 4

### skill-routing-eval
Keep vote criteria (at least one required):
- Pass rate delta >= +0.05 (5 percentage points)
- Category pass rate >= +0.10 on a previously failing category

Veto criteria (any triggers mandatory drop):
- Any previously passing test now fails
- Pass rate drops

Vote values: "keep", "drop", "conditional"
Output must be a JSON object with fields:
  vote, confidence, primary_metric_delta, secondary_signals, concerns, rationale
`;

// ---------------------------------------------------------------------------
// Dry-run stub
// ---------------------------------------------------------------------------

function makeDryRunVote(
  label: ApproachLabel,
  result: ApproachResult
): ReviewerVote {
  if (result.status !== "success" || result.regression_detected) {
    return {
      approach: label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "high",
      primary_metric_delta: "N/A",
      secondary_signals: [],
      concerns: [`status=${result.status}`],
      rationale: `Auto-drop: status=${result.status}, regression=${result.regression_detected}`,
      auto_dropped: true,
    };
  }
  // Fake a "keep" for dry-run
  return {
    approach: label,
    reviewer_agent: 1,
    vote: "keep",
    confidence: "medium",
    primary_metric_delta: "+0.0 (dry-run)",
    secondary_signals: ["dry-run vote"],
    concerns: [],
    rationale: "Dry-run: no real reviewer agent invoked",
    auto_dropped: false,
  };
}

// ---------------------------------------------------------------------------
// Main per-approach analysis
// ---------------------------------------------------------------------------

async function analyzeApproach(
  label: ApproachLabel,
  executeDir: string,
  planDir: string,
  outDir: string,
  twBaseline: unknown,
  srBaseline: unknown,
  dryRun: boolean
): Promise<ReviewerVote> {
  const votePath = join(outDir, `approach-${label}-vote.json`);

  // Idempotency
  if (existsSync(votePath)) {
    console.log(`[phase-4] Vote for approach ${label} already exists — skipping`);
    return readJSON(votePath) as ReviewerVote;
  }

  const resultPath = join(executeDir, `approach-${label}-result.json`);
  if (!existsSync(resultPath)) {
    console.error(`[phase-4] Result not found for approach ${label}: ${resultPath}`);
    const fallbackVote: ReviewerVote = {
      approach: label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "high",
      primary_metric_delta: "N/A",
      secondary_signals: [],
      concerns: ["Result JSON not found — phase 3 may have failed"],
      rationale: `Missing result: ${resultPath}`,
      auto_dropped: true,
    };
    writeFileSync(votePath, JSON.stringify(fallbackVote, null, 2));
    return fallbackVote;
  }

  const result = readJSON(resultPath) as ApproachResult;
  const approachDocPath = join(planDir, `approach-${label}.md`);
  const approachDoc = existsSync(approachDocPath)
    ? readFileSync(approachDocPath, "utf-8")
    : "(approach document not found)";

  // Auto-drop cases: error, degraded, or regression detected
  if (
    result.status === "error" ||
    result.status === "degraded" ||
    result.regression_detected
  ) {
    const reason =
      result.status === "error"
        ? `Implementation failed: ${result.error ?? "unknown error"}`
        : result.status === "degraded"
        ? `Degraded: ${result.error ?? "insufficient judge responses"}`
        : "Regression detected";

    const vote: ReviewerVote = {
      approach: label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "high",
      primary_metric_delta: "N/A",
      secondary_signals: [],
      concerns: [reason],
      rationale: `Auto-drop: status=${result.status}, regression=${result.regression_detected}`,
      auto_dropped: true,
    };
    console.log(`[phase-4] Approach ${label}: auto-drop (${reason})`);
    writeFileSync(votePath, JSON.stringify(vote, null, 2));
    return vote;
  }

  if (dryRun) {
    const vote = makeDryRunVote(label, result);
    writeFileSync(votePath, JSON.stringify(vote, null, 2));
    return vote;
  }

  // Invoke reviewer agent
  console.log(`[phase-4] Invoking reviewer agent for approach ${label}...`);
  const templatePath = join(LOOP_DIR, "templates", "reviewer.md");

  const reviewOutput = await spawnAgent(templatePath, {
    APPROACH_LABEL: label.toUpperCase(),
    APPROACH_DOC: approachDoc,
    RESULT_JSON: JSON.stringify(result, null, 2),
    TW_BASELINE: JSON.stringify(twBaseline ?? {}, null, 2),
    SR_BASELINE: JSON.stringify(srBaseline ?? {}, null, 2),
    DECISION_PROTOCOL: DECISION_PROTOCOL_TEXT,
  });

  const vote = parseReviewerOutput(reviewOutput, label);
  writeFileSync(votePath, JSON.stringify(vote, null, 2));
  console.log(`[phase-4] Approach ${label}: vote=${vote.vote} confidence=${vote.confidence}`);
  return vote;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
  console.log(
    `[phase-4] Starting analyze phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");
  const planDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "analyze");
  mkdirSync(outDir, { recursive: true });

  // Read baselines
  const twBaselinePath = join(
    REPO_ROOT,
    "tech-writer-eval",
    "baselines",
    "latest",
    "scores.json"
  );
  const srBaselinePath = join(
    REPO_ROOT,
    "skill-routing-eval",
    "results",
    "latest.json"
  );
  const twBaseline = readJSONOrNull(twBaselinePath);
  const srBaseline = readJSONOrNull(srBaselinePath);

  // Run 3 reviewer agents in parallel (each independent, no collusion)
  const votes = await Promise.all(
    (["a", "b", "c"] as const).map((label) =>
      analyzeApproach(
        label,
        executeDir,
        planDir,
        outDir,
        twBaseline,
        srBaseline,
        dryRun
      )
    )
  );

  console.log(
    `[phase-4] Analysis complete: ${votes.map((v) => `${v.approach}=${v.vote}`).join(", ")}`
  );

  // Human-readable votes summary
  console.log(`[phase-4] ── Review Votes ─────────────────────────────────`);
  for (const vote of votes) {
    const label = vote.approach.toUpperCase();
    if (vote.auto_dropped) {
      const reason = vote.concerns?.[0] ?? vote.rationale?.slice(0, 60) ?? "auto-dropped";
      console.log(`[phase-4]   ${label}: DROP (auto) — "${reason}"`);
    } else {
      const decisionStr =
        vote.vote === "keep"
          ? `KEEP (${vote.confidence} confidence)`
          : vote.vote === "conditional"
          ? `KEEP conditional (${vote.confidence} confidence)`
          : `DROP (${vote.confidence} confidence)`;
      // Use primary_metric_delta as the first part of the rationale snippet
      const detail = vote.primary_metric_delta && vote.primary_metric_delta !== "unknown"
        ? vote.primary_metric_delta.slice(0, 60)
        : vote.rationale?.slice(0, 60) ?? "";
      console.log(`[phase-4]   ${label}: ${decisionStr} — "${detail}"`);
    }
  }
}

function readJSONOrNull(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error("[phase-4] Fatal error:", err);
  process.exit(1);
});
