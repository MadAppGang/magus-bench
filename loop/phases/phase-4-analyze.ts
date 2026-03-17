#!/usr/bin/env bun
/**
 * Phase 4: Analyze
 * For each approach, spawn one reviewer agent that votes keep/drop/conditional.
 * Auto-drops approaches with status "error", "isolation_failed", or regressionDetected.
 * Runs 3 agents in parallel.
 * Writes vote JSONs to loop/iteration-N/analyze/
 *
 * Now experiment-agnostic: uses experiment plugin for metric formatting
 * and decision criteria text in reviewer prompts.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnAgent } from "../lib/agent.ts";
import { getActiveExperiment, loadExperiment } from "../engine/plugin-registry.ts";
import { DECISION_PROTOCOL_TEXT } from "../engine/decision.ts";
import type { ExperimentResult, ReviewerVote } from "../engine/types.ts";

const REPO_ROOT = "/Users/jack/mag/magus-bench";
const LOOP_DIR = join(REPO_ROOT, "loop");

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  iteration: number;
  dryRun: boolean;
  experiment: string | null;
} {
  let iteration = 1;
  let dryRun = false;
  let experiment: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--iteration" && argv[i + 1]) {
      iteration = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--experiment" && argv[i + 1]) {
      experiment = argv[i + 1];
      i++;
    }
  }
  return { iteration, dryRun, experiment };
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
function parseReviewerOutput(
  output: string,
  label: "a" | "b" | "c"
): ReviewerVote {
  // Try to extract JSON from a fenced code block first
  const fenceMatch = output.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : output.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<ReviewerVote>;
    return {
      label,
      reviewer_agent: 1,
      vote: (parsed.vote as ReviewerVote["vote"]) ?? "drop",
      confidence: (parsed.confidence as ReviewerVote["confidence"]) ?? "low",
      primary_metric_delta: parsed.primary_metric_delta ?? "unknown",
      secondary_signals: parsed.secondary_signals ?? [],
      concerns: parsed.concerns ?? [],
      rationale: parsed.rationale ?? output.slice(0, 500),
      auto_dropped: false,
    };
  } catch {
    // Could not parse JSON — treat as drop with explanation
    console.warn(
      `[phase-4] Could not parse reviewer JSON for approach ${label}, defaulting to drop`
    );
    return {
      label,
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
// Dry-run stub
// ---------------------------------------------------------------------------

function makeDryRunVote(
  label: "a" | "b" | "c",
  result: ExperimentResult
): ReviewerVote {
  if (
    result.status !== "success" ||
    result.regressionDetected ||
    result.status === "isolation_failed"
  ) {
    return {
      label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "high",
      primary_metric_delta: "N/A",
      secondary_signals: [],
      concerns: [`status=${result.status}`],
      rationale: `Auto-drop: status=${result.status}, regression=${result.regressionDetected}`,
      auto_dropped: true,
    };
  }
  // Fake a "keep" for dry-run
  return {
    label,
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
  label: "a" | "b" | "c",
  executeDir: string,
  planDir: string,
  outDir: string,
  baselineMetricsStr: string,
  experimentDescription: string,
  decisionCriteriaText: string,
  dryRun: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  experiment: { formatMetrics: (m: Record<string, any>) => string; formatDelta: (c: Record<string, any>, b: Record<string, any>) => string; readBaseline: () => Promise<Record<string, any> | null> }
): Promise<ReviewerVote> {
  const votePath = join(outDir, `approach-${label}-vote.json`);

  // Idempotency
  if (existsSync(votePath)) {
    console.log(`[phase-4] Vote for approach ${label} already exists — skipping`);
    return readJSON(votePath) as ReviewerVote;
  }

  const resultPath = join(executeDir, `approach-${label}-result.json`);
  if (!existsSync(resultPath)) {
    console.error(
      `[phase-4] Result not found for approach ${label}: ${resultPath}`
    );
    const fallbackVote: ReviewerVote = {
      label,
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

  const result = readJSON(resultPath) as ExperimentResult;
  const approachDocPath = join(planDir, `approach-${label}.md`);
  const approachDoc = existsSync(approachDocPath)
    ? readFileSync(approachDocPath, "utf-8")
    : "(approach document not found)";

  // Auto-drop conditions: error, isolation_failed, or regression detected
  if (
    result.status === "error" ||
    result.status === "isolation_failed" ||
    result.regressionDetected
  ) {
    let reason: string;
    if (result.status === "error") {
      reason = `Implementation failed: ${result.error ?? "unknown error"}`;
    } else if (result.status === "isolation_failed") {
      const files =
        result.isolationViolation?.unexpectedFiles.join(", ") ?? "unknown";
      reason = `Isolation violation: unexpected files changed: ${files}`;
    } else {
      reason = "Regression detected";
    }

    const vote: ReviewerVote = {
      label,
      reviewer_agent: 1,
      vote: "drop",
      confidence: "high",
      primary_metric_delta: "N/A",
      secondary_signals: [],
      concerns: [reason],
      rationale: `Auto-drop: status=${result.status}, regression=${result.regressionDetected}`,
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

  // Format current metrics and delta for reviewer context
  const metricsStr = result.metrics
    ? experiment.formatMetrics(result.metrics as Record<string, number | string | boolean | null>)
    : "(no metrics)";

  const baseline = await experiment.readBaseline();
  const deltaStr = result.metrics && baseline
    ? experiment.formatDelta(
        result.metrics as Record<string, number | string | boolean | null>,
        baseline as Record<string, number | string | boolean | null>
      )
    : "(no baseline)";

  // Invoke reviewer agent
  console.log(`[phase-4] Invoking reviewer agent for approach ${label}...`);
  const templatePath = join(LOOP_DIR, "templates", "reviewer.md");

  const reviewOutput = await spawnAgent(templatePath, {
    APPROACH_LABEL: label.toUpperCase(),
    APPROACH_DOC: approachDoc,
    RESULT_JSON: JSON.stringify(result, null, 2),
    BASELINE_METRICS: baselineMetricsStr,
    EXPERIMENT_DESCRIPTION: experimentDescription,
    METRICS_SUMMARY: metricsStr,
    DELTA_SUMMARY: deltaStr,
    DECISION_PROTOCOL: decisionCriteriaText,
  });

  const vote = parseReviewerOutput(reviewOutput, label);
  writeFileSync(votePath, JSON.stringify(vote, null, 2));
  console.log(
    `[phase-4] Approach ${label}: vote=${vote.vote} confidence=${vote.confidence}`
  );
  return vote;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-4] Starting analyze phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");
  const planDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "analyze");
  mkdirSync(outDir, { recursive: true });

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(LOOP_DIR);
  console.log(`[phase-4] Experiment: ${experiment.name}`);

  // Format baseline for reviewer context
  const baselineDisplay = await experiment.formatBaseline();

  // Decision criteria text — use plugin-specific if available, else generic
  const decisionCriteriaText =
    experiment.decisionCriteriaText ?? DECISION_PROTOCOL_TEXT;

  // Run 3 reviewer agents in parallel (each independent, no collusion)
  const votes = await Promise.all(
    (["a", "b", "c"] as const).map((label) =>
      analyzeApproach(
        label,
        executeDir,
        planDir,
        outDir,
        baselineDisplay,
        experiment.description,
        decisionCriteriaText,
        dryRun,
        experiment
      )
    )
  );

  console.log(
    `[phase-4] Analysis complete: ${votes.map((v) => `${v.label}=${v.vote}`).join(", ")}`
  );

  // Human-readable votes summary
  console.log(
    `[phase-4] ── Review Votes ─────────────────────────────────`
  );
  for (const vote of votes) {
    const label = vote.label.toUpperCase();
    if (vote.auto_dropped) {
      const reason =
        vote.concerns?.[0] ?? vote.rationale?.slice(0, 60) ?? "auto-dropped";
      console.log(`[phase-4]   ${label}: DROP (auto) — "${reason}"`);
    } else {
      const decisionStr =
        vote.vote === "keep"
          ? `KEEP (${vote.confidence} confidence)`
          : vote.vote === "conditional"
          ? `KEEP conditional (${vote.confidence} confidence)`
          : `DROP (${vote.confidence} confidence)`;
      const detail =
        vote.primary_metric_delta &&
        vote.primary_metric_delta !== "unknown"
          ? vote.primary_metric_delta.slice(0, 60)
          : vote.rationale?.slice(0, 60) ?? "";
      console.log(`[phase-4]   ${label}: ${decisionStr} — "${detail}"`);
    }
  }
}

main().catch((err) => {
  console.error("[phase-4] Fatal error:", err);
  process.exit(1);
});
