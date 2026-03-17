#!/usr/bin/env bun
/**
 * Phase 2: Plan
 * Combines 3 research briefs via a single planner agent into 3 non-overlapping
 * implementation approaches. Writes to loop/iteration-N/plan/
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
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function formatBaselineMetrics(
  twBaseline: unknown,
  srBaseline: unknown
): string {
  const lines: string[] = [];
  if (twBaseline && typeof twBaseline === "object") {
    const tw = twBaseline as Record<string, unknown>;
    const weighted = tw.weighted_scores as Record<string, number> | undefined;
    const borda = tw.borda_counts as Record<string, number> | undefined;
    const stats = tw.statistical_tests as Record<string, unknown> | undefined;
    lines.push("tech-writer-eval:");
    if (weighted) lines.push(`  weighted_scores: ${JSON.stringify(weighted)}`);
    if (borda) lines.push(`  borda_counts: ${JSON.stringify(borda)}`);
    if (stats && "friedman_p" in stats) lines.push(`  friedman_p: ${stats.friedman_p}`);
  }
  if (srBaseline && typeof srBaseline === "object") {
    const sr = srBaseline as Record<string, unknown>;
    const results = (sr.results as Record<string, unknown>) ?? sr;
    const stats = results.stats as Record<string, unknown> | undefined;
    if (stats) {
      const s = (stats.successes as number) ?? 0;
      const f = (stats.failures as number) ?? 0;
      const t = s + f;
      lines.push(`skill-routing-eval: pass_rate=${t > 0 ? (s / t).toFixed(3) : "unknown"} (${s}/${t})`);
    }
  }
  return lines.join("\n") || "No baseline data available";
}

/**
 * Read carry-over candidates from the previous iteration's plan-summary.md
 * (the planner records rejected suggestions there).
 */
function readCarryoverCandidates(loopDir: string, iteration: number): string {
  if (iteration <= 1) return "(none — first iteration)";
  const prevSummaryPath = join(
    loopDir,
    `iteration-${iteration - 1}`,
    "plan",
    "plan-summary.md"
  );
  if (!existsSync(prevSummaryPath)) return "(no prior plan summary found)";
  const content = readFileSync(prevSummaryPath, "utf-8");
  // Extract "Rejected" section if present
  const rejectedMatch = content.match(/## Rejected[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (rejectedMatch) {
    return `From iteration ${iteration - 1} plan summary:\n${rejectedMatch[1].trim()}`;
  }
  return `(see loop/iteration-${iteration - 1}/plan/plan-summary.md for context)`;
}

// ---------------------------------------------------------------------------
// Approach document parsing
// ---------------------------------------------------------------------------

/**
 * Parse the planner output into 4 sections.
 * Expects sections delimited by "## Approach A", "## Approach B",
 * "## Approach C", and "## Plan Summary".
 */
function parsePlannerOutput(output: string): {
  approachA: string;
  approachB: string;
  approachC: string;
  planSummary: string;
} {
  // Normalize headers — match case-insensitively
  const sectionRegex =
    /^##\s+(Approach\s+[ABC]|Plan\s+Summary)[^\n]*/gim;

  const matches: Array<{ header: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(output)) !== null) {
    matches.push({ header: match[0].trim(), index: match.index });
  }

  if (matches.length < 3) {
    // Fallback: split by triple newline and treat as 4 equal parts
    const parts = output.split(/\n\n\n+/);
    const chunkSize = Math.ceil(parts.length / 4);
    return {
      approachA: parts.slice(0, chunkSize).join("\n\n"),
      approachB: parts.slice(chunkSize, chunkSize * 2).join("\n\n"),
      approachC: parts.slice(chunkSize * 2, chunkSize * 3).join("\n\n"),
      planSummary: parts.slice(chunkSize * 3).join("\n\n") || output,
    };
  }

  function extractSection(
    sectionLabel: string,
    fallbackContent: string
  ): string {
    const idx = matches.findIndex((m) =>
      m.header.toLowerCase().includes(sectionLabel.toLowerCase())
    );
    if (idx === -1) return fallbackContent;
    const start = matches[idx].index;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : output.length;
    return output.slice(start, end).trim();
  }

  return {
    approachA: extractSection("approach a", ""),
    approachB: extractSection("approach b", ""),
    approachC: extractSection("approach c", ""),
    planSummary: extractSection("plan summary", output),
  };
}

/**
 * Extract the title from an approach document.
 * Looks for "**Title**:" or "Title:" or the first ## heading.
 */
function extractApproachTitle(doc: string): string {
  const match =
    doc.match(/^\*\*Title\*\*:\s*(.+)/m) ??
    doc.match(/^Title:\s*(.+)/im) ??
    doc.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
  return match?.[1]?.trim().slice(0, 80) ?? "(no title)";
}

/**
 * Extract the target eval from an approach document.
 * Looks for "**Target eval**:" or "Target eval:".
 */
function extractTargetEval(doc: string): string {
  const match =
    doc.match(/^\*\*Target[_\s]eval\*\*:\s*(.+)/im) ??
    doc.match(/^Target[_\s]eval:\s*(.+)/im);
  return match?.[1]?.trim().slice(0, 40) ?? "unknown";
}

/**
 * Validate that an approach document contains the required fields.
 * Logs a warning but does not throw — a partial doc is better than aborting.
 */
function validateApproachDoc(label: string, doc: string): void {
  const requiredPatterns = [
    { name: "title", pattern: /title/i },
    { name: "target_eval", pattern: /target[_\s]eval|tech-writer-eval|skill-routing-eval/i },
    { name: "files", pattern: /file[s]?\s*to\s*change|file[s]?:/i },
    { name: "expected_delta", pattern: /expected[_\s](metric[_\s])?delta|expected[_\s]effect/i },
    { name: "risk", pattern: /risk\s*(level)?:/i },
  ];

  const missing = requiredPatterns.filter((p) => !p.pattern.test(doc));
  if (missing.length > 0) {
    console.warn(
      `[phase-2] Warning: approach-${label}.md missing fields: ${missing.map((m) => m.name).join(", ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// Dry-run stubs
// ---------------------------------------------------------------------------

function makeDryRunApproachA(iteration: number): string {
  return `## Approach A — Add second evaluation topic for statistical power

**Title**: Add second evaluation topic for Friedman significance

**Target eval**: tech-writer-eval

**Files to change**:
- tech-writer-eval/test-cases.json

**Change description**:
Add a second topic (e.g., "Git branching strategies") to test-cases.json with a corresponding reference document. This doubles the number of judge data points from 7 to 14, dramatically improving Friedman test power.

**Expected metric delta**: Friedman p expected to decrease from 0.66 to ~0.30

**Risk level**: medium

**Estimated run time**: 25 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunApproachB(iteration: number): string {
  return `## Approach B — Improve skill-routing test coverage for underrepresented categories

**Title**: Add test cases for agent-vs-skill and ambient categories

**Target eval**: skill-routing-eval

**Files to change**:
- skill-routing-eval/test-cases.yaml
- skill-routing-eval/promptfooconfig.yaml

**Change description**:
Add 4 new test cases (2 per category) for categories currently at 0% pass rate. Update promptfooconfig.yaml to reference the new test cases.

**Expected metric delta**: Pass rate delta +0.09 (2 additional passes out of 22+4=26 total)

**Risk level**: low

**Estimated run time**: 5 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunApproachC(iteration: number): string {
  return `## Approach C — Strengthen judge rubric anchor descriptions

**Title**: Add explicit scoring anchors to judge template criteria

**Target eval**: tech-writer-eval

**Files to change**:
- tech-writer-eval/prompts/judge-template-4way.md

**Change description**:
For each of the 9 evaluation criteria, add 1-2 sentence examples of what a "1", "5", and "10" score looks like. This reduces inter-judge variance by providing concrete reference points.

**Expected metric delta**: Weighted score delta +0.15, Bootstrap CI narrows by ~0.10

**Risk level**: low

**Estimated run time**: 18 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunPlanSummary(iteration: number): string {
  return `## Plan Summary

**Iteration**: ${iteration}

**Selection rationale**:
- Approach A targets the highest-priority weakness: Friedman p=0.66 indicates weak statistical power. Adding a topic is the most direct fix.
- Approach B covers skill-routing-eval (required per loop rules to advance both evals each iteration).
- Approach C is an incremental rubric improvement with low risk as a hedge.

**Rejected suggestions**:
- Temperature variation for judges (Agent A): deferred — adding a topic is higher priority.
- CoT instructions for generation (Agent B): deferred — rubric improvements first.

(dry-run plan summary for iteration ${iteration})
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[phase-2] Starting plan phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`);

  const researchDir = join(LOOP_DIR, `iteration-${iteration}`, "research");
  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  mkdirSync(outDir, { recursive: true });

  // Idempotency
  const summaryPath = join(outDir, "plan-summary.md");
  if (existsSync(summaryPath)) {
    console.log("[phase-2] Plan summary already exists — skipping");
    process.exit(0);
  }

  if (dryRun) {
    console.log("[phase-2] Dry-run: writing stub plan documents");
    const dryA = makeDryRunApproachA(iteration);
    const dryB = makeDryRunApproachB(iteration);
    const dryC = makeDryRunApproachC(iteration);
    writeFileSync(join(outDir, "approach-a.md"), dryA);
    writeFileSync(join(outDir, "approach-b.md"), dryB);
    writeFileSync(join(outDir, "approach-c.md"), dryC);
    writeFileSync(summaryPath, makeDryRunPlanSummary(iteration));
    console.log(`[phase-2] ✎ Plan — 3 approaches selected:`);
    console.log(`[phase-2]   A: ${extractApproachTitle(dryA).padEnd(50)}  → target: ${extractTargetEval(dryA)}`);
    console.log(`[phase-2]   B: ${extractApproachTitle(dryB).padEnd(50)}  → target: ${extractTargetEval(dryB)}`);
    console.log(`[phase-2]   C: ${extractApproachTitle(dryC).padEnd(50)}  → target: ${extractTargetEval(dryC)}`);
    process.exit(0);
  }

  // Read 3 research briefs
  const briefAPath = join(researchDir, "agent-a-brief.md");
  const briefBPath = join(researchDir, "agent-b-brief.md");
  const briefCPath = join(researchDir, "agent-c-brief.md");

  for (const [label, p] of [["A", briefAPath], ["B", briefBPath], ["C", briefCPath]]) {
    if (!existsSync(p)) {
      console.error(`[phase-2] Missing research brief ${label} at ${p}`);
      process.exit(1);
    }
  }

  const briefA = readFileSync(briefAPath, "utf-8");
  const briefB = readFileSync(briefBPath, "utf-8");
  const briefC = readFileSync(briefCPath, "utf-8");

  // Carry-over from previous iteration
  const carryoverCandidates = readCarryoverCandidates(LOOP_DIR, iteration);

  // Config context
  const configPath = join(LOOP_DIR, "config.json");
  const config = (readJSON(configPath) ?? {}) as Record<string, unknown>;
  const evalsEnabled = (config.evals_enabled as string[] | undefined) ?? [
    "tech-writer-eval",
    "skill-routing-eval",
  ];

  // Baseline metrics for context
  const twBaseline = readJSON(
    join(REPO_ROOT, "tech-writer-eval", "baselines", "latest", "scores.json")
  );
  const srBaseline = readJSON(
    join(REPO_ROOT, "skill-routing-eval", "results", "latest.json")
  );
  const baselineMetrics = formatBaselineMetrics(twBaseline, srBaseline);

  // Invoke planner agent
  console.log("[phase-2] Invoking planner agent...");
  const templatePath = join(LOOP_DIR, "templates", "planner.md");

  const planOutput = await spawnAgent(templatePath, {
    ITERATION: String(iteration),
    BRIEF_A: briefA,
    BRIEF_B: briefB,
    BRIEF_C: briefC,
    CARRYOVER_CANDIDATES: carryoverCandidates,
    EVALS_ENABLED: evalsEnabled.join(", "),
    BASELINE_METRICS: baselineMetrics,
  });

  // Parse planner output into sections
  const { approachA, approachB, approachC, planSummary } =
    parsePlannerOutput(planOutput);

  // Validate each approach doc
  validateApproachDoc("a", approachA);
  validateApproachDoc("b", approachB);
  validateApproachDoc("c", approachC);

  // Write outputs
  const docA = approachA || planOutput;
  const docB = approachB || "(no approach B parsed)";
  const docC = approachC || "(no approach C parsed)";
  writeFileSync(join(outDir, "approach-a.md"), docA);
  writeFileSync(join(outDir, "approach-b.md"), docB);
  writeFileSync(join(outDir, "approach-c.md"), docC);
  writeFileSync(summaryPath, planSummary || planOutput);

  console.log(`[phase-2] ✎ Plan — 3 approaches selected:`);
  console.log(`[phase-2]   A: ${extractApproachTitle(docA).padEnd(50)}  → target: ${extractTargetEval(docA)}`);
  console.log(`[phase-2]   B: ${extractApproachTitle(docB).padEnd(50)}  → target: ${extractTargetEval(docB)}`);
  console.log(`[phase-2]   C: ${extractApproachTitle(docC).padEnd(50)}  → target: ${extractTargetEval(docC)}`);
  console.log(`[phase-2]   approach-a.md: ${join(outDir, "approach-a.md")}`);
  console.log(`[phase-2]   approach-b.md: ${join(outDir, "approach-b.md")}`);
  console.log(`[phase-2]   approach-c.md: ${join(outDir, "approach-c.md")}`);
  console.log(`[phase-2]   plan-summary.md: ${summaryPath}`);
}

main().catch((err) => {
  console.error("[phase-2] Fatal error:", err);
  process.exit(1);
});
