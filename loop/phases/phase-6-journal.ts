#!/usr/bin/env bun
/**
 * Phase 6: Journal
 * Reads all phase outputs for this iteration, assembles a structured
 * journal entry, appends it to loop/journal.md, commits, and writes
 * a journal-written.marker sentinel.
 */

import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";

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
// Types
// ---------------------------------------------------------------------------

type ApproachLabel = "a" | "b" | "c";

interface ReviewerVote {
  approach: ApproachLabel;
  vote: string;
  confidence: string;
  auto_dropped: boolean;
  rationale: string;
  concerns: string[];
  primary_metric_delta: string;
}

interface ApproachResult {
  approach: ApproachLabel;
  target_eval: string;
  status: string;
  error: string | null;
  metrics: Record<string, unknown> | null;
  baseline_deltas: Record<string, number> | null;
  regression_detected: boolean;
  run_dir: string | null;
}

interface DecisionEntry {
  label: ApproachLabel;
  outcome: "merge" | "drop";
  reason: string;
  commit_hash?: string;
}

interface DecisionSummary {
  iteration: number;
  merged: ApproachLabel[];
  dropped: ApproachLabel[];
  all_dropped: boolean;
  decisions: DecisionEntry[];
  new_tw_baseline: unknown | null;
  new_sr_baseline: unknown | null;
  decided_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSONOrNull(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function readFileOrEmpty(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function nowUTC(): string {
  return new Date().toUTCString().replace("GMT", "UTC");
}

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "(empty)";
}

/**
 * Extract a 1-sentence summary from a research brief.
 * Looks for the first non-header, non-empty line after the main heading.
 */
function extractBriefSummary(brief: string): string {
  const lines = brief.split("\n").filter((l) => l.trim());
  // Skip title lines (starting with #)
  const summaryLine = lines.find(
    (l) => !l.startsWith("#") && !l.startsWith("**Iteration") && l.trim()
  );
  return summaryLine?.slice(0, 120) ?? "(no summary available)";
}

/**
 * Extract the approach title from an approach doc.
 */
function extractApproachTitle(approachDoc: string, label: ApproachLabel): string {
  const titleMatch =
    approachDoc.match(/^\*\*Title\*\*:\s*(.+)/m) ??
    approachDoc.match(/^Title:\s*(.+)/im) ??
    approachDoc.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
  return titleMatch?.[1]?.trim().slice(0, 80) ?? `Approach ${label.toUpperCase()}`;
}

/**
 * Extract risk and target eval from an approach doc.
 */
function extractApproachMeta(approachDoc: string): {
  riskLevel: string;
  targetEval: string;
} {
  const riskMatch = approachDoc.match(/\*\*Risk[_\s]level\*\*:\s*(\S+)/i) ??
    approachDoc.match(/Risk\s*(?:level)?:\s*(\S+)/i);
  const targetMatch =
    approachDoc.match(/\*\*Target[_\s]eval\*\*:\s*(.+)/i) ??
    approachDoc.match(/Target\s*eval:\s*(.+)/i);
  return {
    riskLevel: riskMatch?.[1]?.trim() ?? "unknown",
    targetEval: targetMatch?.[1]?.trim() ?? "unknown",
  };
}

/**
 * Format metrics for the execute table row.
 */
function formatMetrics(result: ApproachResult): { primary: string; delta: string } {
  if (result.status !== "success" || !result.metrics) {
    return { primary: "—", delta: "—" };
  }

  const m = result.metrics;
  const d = result.baseline_deltas ?? {};

  if (result.target_eval === "tech-writer-eval" || result.target_eval === "both") {
    const ws = m.weighted_scores as Record<string, number> | undefined;
    const bc = m.borda_counts as Record<string, number> | undefined;
    const fp = m.friedman_p as number | null | undefined;

    const primary = [
      ws?.techwriter != null ? `weighted=${ws.techwriter.toFixed(1)}` : null,
      bc?.techwriter != null ? `borda=${bc.techwriter}` : null,
      fp != null ? `p=${fp.toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    const delta = [
      d.techwriter_weighted != null
        ? `${d.techwriter_weighted >= 0 ? "+" : ""}${d.techwriter_weighted.toFixed(2)}`
        : null,
      d.techwriter_borda != null
        ? `${d.techwriter_borda >= 0 ? "+" : ""}${d.techwriter_borda}`
        : null,
      d.friedman_p_delta != null
        ? `p${d.friedman_p_delta >= 0 ? "+" : ""}${d.friedman_p_delta.toFixed(2)}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    return { primary: primary || "—", delta: delta || "0" };
  }

  if (result.target_eval === "skill-routing-eval") {
    const pr = m.pass_rate as number | undefined;
    const primary = pr != null ? `pass_rate=${pr.toFixed(3)}` : "—";
    const delta =
      d.pass_rate_delta != null
        ? `${d.pass_rate_delta >= 0 ? "+" : ""}${d.pass_rate_delta.toFixed(3)}`
        : "0";
    return { primary, delta };
  }

  return { primary: "—", delta: "—" };
}

// ---------------------------------------------------------------------------
// Journal initialization
// ---------------------------------------------------------------------------

function ensureJournalHeader(): void {
  const journalPath = join(LOOP_DIR, "journal.md");
  if (!existsSync(journalPath)) {
    const header = `# Continuous Eval Improvement Loop Journal

**Repository**: ${REPO_ROOT}
**Loop started**: ${nowUTC()}
**Loop config**: loop/config.json
**Evals**: tech-writer-eval, skill-routing-eval

---
`;
    writeFileSync(journalPath, header, "utf-8");
    console.log("[phase-6] Created journal.md with header");
  }
}

// ---------------------------------------------------------------------------
// Cumulative metrics extraction
// ---------------------------------------------------------------------------

function extractCumulativeMetrics(loopDir: string, currentIteration: number): string {
  const twHistory: string[] = [];
  const srHistory: string[] = [];
  const pHistory: string[] = [];

  for (let i = 1; i <= currentIteration; i++) {
    const summaryPath = join(loopDir, `iteration-${i}`, "decision", "decision-summary.json");
    const summary = readJSONOrNull(summaryPath) as DecisionSummary | null;
    if (!summary) continue;

    // Try to extract from new_tw_baseline
    const twBase = summary.new_tw_baseline as Record<string, unknown> | null;
    if (twBase) {
      const ws = twBase.weighted_scores as Record<string, number> | undefined;
      const bc = twBase.borda_counts as Record<string, number> | undefined;
      const stats = twBase.statistical_tests as Record<string, unknown> | undefined;
      if (ws?.techwriter != null) twHistory.push(ws.techwriter.toFixed(1));
      if (bc?.techwriter != null) {
        // included in borda line
      }
      if (stats?.friedman_p != null) pHistory.push((stats.friedman_p as number).toFixed(2));
    }

    const srBase = summary.new_sr_baseline as Record<string, unknown> | null;
    if (srBase) {
      const results = (srBase.results as Record<string, unknown>) ?? srBase;
      const stats = results.stats as Record<string, unknown> | undefined;
      if (stats) {
        const s = (stats.successes as number) ?? 0;
        const f = (stats.failures as number) ?? 0;
        const t = s + f;
        if (t > 0) srHistory.push((s / t).toFixed(3));
      }
    }
  }

  const lines: string[] = [];
  if (twHistory.length > 0) {
    lines.push(`- techwriter weighted history: [${twHistory.join(" → ")}]`);
  }
  if (pHistory.length > 0) {
    lines.push(`- Friedman p history: [${pHistory.join(" → ")}]`);
  }
  if (srHistory.length > 0) {
    lines.push(`- skill-routing pass rate history: [${srHistory.join(" → ")}]`);
  }
  if (lines.length === 0) {
    lines.push("- (no cumulative baseline data yet)");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Journal entry builder
// ---------------------------------------------------------------------------

function buildIterationEntry(iteration: number): string {
  const iterDir = join(LOOP_DIR, `iteration-${iteration}`);
  const researchDir = join(iterDir, "research");
  const planDir = join(iterDir, "plan");
  const executeDir = join(iterDir, "execute");
  const analyzeDir = join(iterDir, "analyze");
  const decisionDir = join(iterDir, "decision");

  // Read all data
  const briefA = readFileOrEmpty(join(researchDir, "agent-a-brief.md"));
  const briefB = readFileOrEmpty(join(researchDir, "agent-b-brief.md"));
  const briefC = readFileOrEmpty(join(researchDir, "agent-c-brief.md"));

  const approachADoc = readFileOrEmpty(join(planDir, "approach-a.md"));
  const approachBDoc = readFileOrEmpty(join(planDir, "approach-b.md"));
  const approachCDoc = readFileOrEmpty(join(planDir, "approach-c.md"));

  const resultA = readJSONOrNull(join(executeDir, "approach-a-result.json")) as ApproachResult | null;
  const resultB = readJSONOrNull(join(executeDir, "approach-b-result.json")) as ApproachResult | null;
  const resultC = readJSONOrNull(join(executeDir, "approach-c-result.json")) as ApproachResult | null;

  const voteA = readJSONOrNull(join(analyzeDir, "approach-a-vote.json")) as ReviewerVote | null;
  const voteB = readJSONOrNull(join(analyzeDir, "approach-b-vote.json")) as ReviewerVote | null;
  const voteC = readJSONOrNull(join(analyzeDir, "approach-c-vote.json")) as ReviewerVote | null;

  const decision = readJSONOrNull(join(decisionDir, "decision-summary.json")) as DecisionSummary | null;

  // Baseline at start of iteration
  const twBaselinePath = join(REPO_ROOT, "tech-writer-eval", "baselines", "latest", "scores.json");
  const srBaselinePath = join(REPO_ROOT, "skill-routing-eval", "results", "latest.json");
  const twBaseline = readJSONOrNull(twBaselinePath) as Record<string, unknown> | null;
  const srBaseline = readJSONOrNull(srBaselinePath) as Record<string, unknown> | null;

  // Format baseline info
  let baselineInfo = "";
  if (twBaseline) {
    const ws = twBaseline.weighted_scores as Record<string, number> | undefined;
    const bc = twBaseline.borda_counts as Record<string, number> | undefined;
    const stats = twBaseline.statistical_tests as Record<string, unknown> | undefined;
    const fp = stats?.friedman_p;
    baselineInfo += `- tech-writer-eval: techwriter weighted=${ws?.techwriter?.toFixed(1) ?? "?"}, borda=${bc?.techwriter ?? "?"}, Friedman p=${fp ?? "?"}\n`;
  }
  if (srBaseline) {
    const results = (srBaseline.results as Record<string, unknown>) ?? srBaseline;
    const stats = results.stats as Record<string, unknown> | undefined;
    if (stats) {
      const s = (stats.successes as number) ?? 0;
      const f = (stats.failures as number) ?? 0;
      const t = s + f;
      baselineInfo += `- skill-routing-eval: pass_rate=${t > 0 ? (s / t).toFixed(3) : "?"} (${s}/${t} tests passing)\n`;
    }
  }
  if (!baselineInfo) baselineInfo = "- (baseline data not available)\n";

  // Approach metadata
  const metaA = extractApproachMeta(approachADoc);
  const metaB = extractApproachMeta(approachBDoc);
  const metaC = extractApproachMeta(approachCDoc);

  const titleA = extractApproachTitle(approachADoc, "a");
  const titleB = extractApproachTitle(approachBDoc, "b");
  const titleC = extractApproachTitle(approachCDoc, "c");

  // Execute table rows
  function execRow(label: ApproachLabel, result: ApproachResult | null): string {
    if (!result) return `| ${label.toUpperCase()} | missing | — | — |`;
    const { primary, delta } = formatMetrics(result);
    const statusStr = result.status === "success"
      ? result.regression_detected ? "regression" : "success"
      : result.status;
    return `| ${label.toUpperCase()} | ${statusStr} | ${primary} | ${delta} |`;
  }

  // Analyze table rows
  function analyzeRow(label: ApproachLabel, vote: ReviewerVote | null): string {
    if (!vote) return `| ${label.toUpperCase()} | missing | DROP |`;
    const consensus = vote.auto_dropped
      ? "DROP (auto)"
      : vote.vote === "keep"
      ? "KEEP"
      : vote.vote === "conditional"
      ? "KEEP (conditional)"
      : "DROP";
    return `| ${label.toUpperCase()} | ${vote.vote} (${vote.confidence}) | ${consensus} |`;
  }

  // Decision section
  function decisionMergedLine(entry: DecisionEntry): string {
    return `- loop/iter-${iteration}/approach-${entry.label} → commit ${entry.commit_hash ?? "unknown"}: "${entry.reason.slice(0, 100)}"`;
  }

  function decisionDroppedLine(entry: DecisionEntry): string {
    return `- loop/iter-${iteration}/approach-${entry.label}: ${entry.reason.slice(0, 100)}`;
  }

  const mergedEntries = decision?.decisions.filter((d) => d.outcome === "merge") ?? [];
  const droppedEntries = decision?.decisions.filter((d) => d.outcome === "drop") ?? [];

  const cumulativeMetrics = extractCumulativeMetrics(LOOP_DIR, iteration);

  // Assemble entry (FR-6.3: first line must include UTC timestamp to millisecond precision)
  const ts = new Date().toISOString(); // e.g. 2026-03-17T15:30:00.123Z
  const dateStr = ts.slice(0, 10);

  const entry = `
---

## Iteration ${iteration} — ${dateStr} ${ts.slice(11, 23)} UTC

**Git HEAD at start**: (see git log)
**Baseline at start**:
${baselineInfo.trimEnd()}

### Phase 1: Research

**Agent A (methodology)**: ${extractBriefSummary(briefA)}
Full brief: loop/iteration-${iteration}/research/agent-a-brief.md

**Agent B (prompts/rubrics)**: ${extractBriefSummary(briefB)}
Full brief: loop/iteration-${iteration}/research/agent-b-brief.md

**Agent C (structure/topics)**: ${extractBriefSummary(briefC)}
Full brief: loop/iteration-${iteration}/research/agent-c-brief.md

### Phase 2: Plan

| # | Title | Target | Risk | Expected Delta |
|---|-------|--------|------|----------------|
| A | ${titleA} | ${metaA.targetEval} | ${metaA.riskLevel} | (see approach doc) |
| B | ${titleB} | ${metaB.targetEval} | ${metaB.riskLevel} | (see approach doc) |
| C | ${titleC} | ${metaC.targetEval} | ${metaC.riskLevel} | (see approach doc) |

Full plan: loop/iteration-${iteration}/plan/plan-summary.md

### Phase 3: Execute

| Approach | Status | Primary Metrics | Baseline Delta |
|----------|--------|-----------------|----------------|
${execRow("a", resultA)}
${execRow("b", resultB)}
${execRow("c", resultC)}

Results archived: loop/iteration-${iteration}/execute/results/

### Phase 4: Analyze

| Approach | Reviewer Vote | Consensus |
|----------|--------------|-----------|
${analyzeRow("a", voteA)}
${analyzeRow("b", voteB)}
${analyzeRow("c", voteC)}

Full votes: loop/iteration-${iteration}/analyze/

### Phase 5: Decision

**Merged**:
${mergedEntries.length > 0 ? mergedEntries.map(decisionMergedLine).join("\n") : "- (none)"}

**Dropped**:
${droppedEntries.length > 0 ? droppedEntries.map(decisionDroppedLine).join("\n") : "- (none)"}

**New baseline captured**: ${mergedEntries.length > 0 ? "yes (see baselines/latest/ and skill-routing-eval/results/latest.json)" : "no merges — baseline unchanged"}

**Cumulative metrics**:
${cumulativeMetrics}

**Next iteration focus**: ${droppedEntries.length > 0 ? droppedEntries.map((d) => d.reason.slice(0, 60)).join("; ") : "(all merged — no carry-over)"}
`;

  return entry;
}

// ---------------------------------------------------------------------------
// Shell helper
// ---------------------------------------------------------------------------

interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawnShell(
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {}
): Promise<ShellResult> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `Command failed (code ${code}): ${args.join(" ")}\nstderr: ${stderr.slice(0, 500)}`
    );
  }
  return { code, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
  console.log(
    `[phase-6] Starting journal phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const iterDir = join(LOOP_DIR, `iteration-${iteration}`);
  mkdirSync(iterDir, { recursive: true });

  // Idempotency
  const markerPath = join(iterDir, "journal-written.marker");
  if (existsSync(markerPath)) {
    console.log("[phase-6] Journal already written for this iteration — skipping");
    process.exit(0);
  }

  // Ensure journal header exists
  ensureJournalHeader();

  // Build journal entry
  const entry = buildIterationEntry(iteration);

  // Append to journal.md
  const journalPath = join(LOOP_DIR, "journal.md");
  appendFileSync(journalPath, entry, "utf-8");

  // Read decision summary for the 1-liner
  const decisionSummaryPath = join(LOOP_DIR, `iteration-${iteration}`, "decision", "decision-summary.json");
  const decisionSummary = readJSONOrNull(decisionSummaryPath) as {
    merged?: string[];
    dropped?: string[];
  } | null;
  const mergedCount = decisionSummary?.merged?.length ?? 0;
  const droppedCount = decisionSummary?.dropped?.length ?? 0;
  console.log(`[phase-6] Journal updated — iteration ${iteration} appended (merged: ${mergedCount}, dropped: ${droppedCount})`);
  console.log(`[phase-6] Appended iteration ${iteration} entry to ${journalPath}`);

  if (!dryRun) {
    // Commit journal.md to git (FR-6.1)
    await spawnShell(
      ["git", "-C", REPO_ROOT, "add", journalPath],
      { allowFailure: true }
    );
    const commitResult = await spawnShell(
      [
        "git",
        "-C",
        REPO_ROOT,
        "commit",
        "-m",
        `loop: iter ${iteration} journal`,
      ],
      { allowFailure: true }
    );
    if (commitResult.code !== 0) {
      console.warn(
        `[phase-6] Journal commit warning (code ${commitResult.code}): ${commitResult.stderr.slice(0, 200)}`
      );
    } else {
      console.log("[phase-6] Journal committed to git");
    }
  } else {
    console.log("[phase-6] Dry-run: skipping git commit");
  }

  // Write sentinel
  writeFileSync(markerPath, new Date().toISOString());
  console.log(`[phase-6] Journal phase complete for iteration ${iteration}`);
}

main().catch((err) => {
  console.error("[phase-6] Fatal error:", err);
  process.exit(1);
});
