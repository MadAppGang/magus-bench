#!/usr/bin/env bun
/**
 * Phase 2: Plan
 * Combines 3 research briefs via a single planner agent into 3 non-overlapping
 * implementation approaches. Writes to loop/iteration-N/plan/
 *
 * Now experiment-agnostic: uses experiment.changeableFiles to validate
 * that approaches only propose changes to authorized files.
 * Injects hypothesis knowledge into planner context.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnAgent } from "../lib/agent.ts";
import { getActiveExperiment, loadExperiment } from "../engine/plugin-registry.ts";
import { HypothesisRegistry } from "../engine/hypothesis.ts";

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
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
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
  const rejectedMatch = content.match(
    /## Rejected[^\n]*\n([\s\S]*?)(?=\n##|$)/i
  );
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
    const end =
      idx + 1 < matches.length ? matches[idx + 1].index : output.length;
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
 * Extract the files to change from an approach document.
 */
function extractFilesToChange(doc: string): string[] {
  const files: string[] = [];
  // Match lines like "- `path/to/file.ext`" or "- path/to/file.ext"
  const fileMatches = doc.matchAll(/^[-*]\s+`?([^\s`]+\.[a-z]+[^`\s]*)`?/gim);
  for (const m of fileMatches) {
    if (m[1] && !m[1].startsWith("#")) {
      files.push(m[1].trim());
    }
  }
  return files;
}

/**
 * Validate that an approach document contains the required fields.
 * Now also checks that filesToChange are within experiment.changeableFiles.
 * Logs warnings but does not throw.
 */
function validateApproachDoc(
  label: string,
  doc: string,
  changeableFiles: string[]
): void {
  const requiredPatterns = [
    { name: "title", pattern: /title/i },
    { name: "files_to_change", pattern: /file[s]?\s*to\s*change|file[s]?:/i },
    {
      name: "expected_delta",
      pattern: /expected[_\s](metric[_\s])?delta|expected[_\s]effect/i,
    },
    { name: "risk", pattern: /risk\s*(level)?:/i },
  ];

  const missing = requiredPatterns.filter((p) => !p.pattern.test(doc));
  if (missing.length > 0) {
    console.warn(
      `[phase-2] Warning: approach-${label}.md missing fields: ${missing
        .map((m) => m.name)
        .join(", ")}`
    );
  }

  // Warn if any proposed file is outside changeableFiles
  const proposedFiles = extractFilesToChange(doc);
  if (proposedFiles.length > 0 && changeableFiles.length > 0) {
    for (const f of proposedFiles) {
      const isAllowed = changeableFiles.some(
        (pattern) =>
          f === pattern ||
          f.startsWith(pattern.replace(/\*.*$/, "")) ||
          pattern.includes("*")
      );
      if (!isAllowed) {
        console.warn(
          `[phase-2] Warning: approach-${label} proposes changes to "${f}" which may be outside experiment.changeableFiles`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dry-run stubs
// ---------------------------------------------------------------------------

function makeDryRunApproachA(
  iteration: number,
  changeableFiles: string[]
): string {
  const primaryFile = changeableFiles[0] ?? "experiment/test-cases.json";
  return `## Approach A — Increase sample size for statistical power

**Title**: Add additional evaluation samples for statistical significance

**Hypothesis ID**: h-0001

**Files to change**:
- ${primaryFile}

**Change description**:
Add additional data points to increase statistical test power. This directly addresses the primary weakness in the current evaluation.

**Expected metric delta**: Primary metric expected to improve by 10-15%

**Risk level**: medium

**Estimated run time**: 25 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunApproachB(
  iteration: number,
  changeableFiles: string[]
): string {
  const primaryFile = changeableFiles[1] ?? changeableFiles[0] ?? "experiment/config.yaml";
  return `## Approach B — Improve evaluation coverage for edge cases

**Title**: Add test cases for underrepresented scenarios

**Hypothesis ID**: h-0002

**Files to change**:
- ${primaryFile}

**Change description**:
Add new test cases targeting categories with low pass rates. Update configuration to reference the new test cases.

**Expected metric delta**: Metric delta +5-10 percentage points

**Risk level**: low

**Estimated run time**: 5 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunApproachC(
  iteration: number,
  changeableFiles: string[]
): string {
  const primaryFile = changeableFiles[0] ?? "experiment/prompts/template.md";
  return `## Approach C — Strengthen evaluation criteria specificity

**Title**: Add explicit scoring anchors to evaluation criteria

**Hypothesis ID**: h-0003

**Files to change**:
- ${primaryFile}

**Change description**:
For each evaluation criterion, add concrete examples of what each score level looks like. This reduces inter-evaluator variance by providing reference points.

**Expected metric delta**: Primary metric delta +0.1-0.2, variance reduction ~10%

**Risk level**: low

**Estimated run time**: 18 minutes

(dry-run approach doc for iteration ${iteration})
`;
}

function makeDryRunPlanSummary(iteration: number): string {
  return `## Plan Summary

**Iteration**: ${iteration}

**Selection rationale**:
- Approach A targets the highest-priority weakness: statistical power. Adding samples is the most direct fix.
- Approach B covers edge case coverage (required to advance the experiment each iteration).
- Approach C is an incremental criteria improvement with low risk as a hedge.

**Rejected suggestions**:
- Alternative methodology (Agent A): deferred — adding samples is higher priority.
- CoT instructions (Agent B): deferred — criteria improvements first.

(dry-run plan summary for iteration ${iteration})
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-2] Starting plan phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const researchDir = join(LOOP_DIR, `iteration-${iteration}`, "research");
  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  mkdirSync(outDir, { recursive: true });

  // Idempotency
  const summaryPath = join(outDir, "plan-summary.md");
  if (existsSync(summaryPath)) {
    console.log("[phase-2] Plan summary already exists — skipping");
    process.exit(0);
  }

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(LOOP_DIR);
  console.log(`[phase-2] Experiment: ${experiment.name}`);

  if (dryRun) {
    console.log("[phase-2] Dry-run: writing stub plan documents");
    const dryA = makeDryRunApproachA(iteration, experiment.changeableFiles);
    const dryB = makeDryRunApproachB(iteration, experiment.changeableFiles);
    const dryC = makeDryRunApproachC(iteration, experiment.changeableFiles);
    writeFileSync(join(outDir, "approach-a.md"), dryA);
    writeFileSync(join(outDir, "approach-b.md"), dryB);
    writeFileSync(join(outDir, "approach-c.md"), dryC);
    writeFileSync(summaryPath, makeDryRunPlanSummary(iteration));
    console.log(`[phase-2] ✎ Plan — 3 approaches selected:`);
    console.log(
      `[phase-2]   A: ${extractApproachTitle(dryA).padEnd(50)}  → target: ${experiment.name}`
    );
    console.log(
      `[phase-2]   B: ${extractApproachTitle(dryB).padEnd(50)}  → target: ${experiment.name}`
    );
    console.log(
      `[phase-2]   C: ${extractApproachTitle(dryC).padEnd(50)}  → target: ${experiment.name}`
    );
    process.exit(0);
  }

  // Read 3 research briefs
  const briefAPath = join(researchDir, "agent-a-brief.md");
  const briefBPath = join(researchDir, "agent-b-brief.md");
  const briefCPath = join(researchDir, "agent-c-brief.md");

  for (const [label, p] of [
    ["A", briefAPath],
    ["B", briefBPath],
    ["C", briefCPath],
  ]) {
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

  // Hypothesis knowledge
  const registry = new HypothesisRegistry(LOOP_DIR);
  const hypothesisKnowledge = registry.getKnowledgeSummary(10);

  // Baseline display
  const baselineDisplay = await experiment.formatBaseline();

  // Read config for extra context
  const config = (readJSON(join(LOOP_DIR, "config.json")) ?? {}) as Record<
    string,
    unknown
  >;

  // Invoke planner agent
  console.log("[phase-2] Invoking planner agent...");
  const templatePath = join(LOOP_DIR, "templates", "planner.md");

  const planOutput = await spawnAgent(templatePath, {
    ITERATION: String(iteration),
    EXPERIMENT_NAME: experiment.name,
    EXPERIMENT_DESCRIPTION: experiment.description,
    BRIEF_A: briefA,
    BRIEF_B: briefB,
    BRIEF_C: briefC,
    CARRYOVER_CANDIDATES: carryoverCandidates,
    CHANGEABLE_FILES: experiment.changeableFiles.join("\n"),
    CONTEXT_FILES: experiment.contextFiles.join("\n"),
    RESEARCH_HINTS: experiment.researchHints.join("\n"),
    DEPENDENT_VARIABLES: experiment.dependentVariables.join(", "),
    HYPOTHESIS_KNOWLEDGE: hypothesisKnowledge,
    BASELINE_METRICS: baselineDisplay,
    RESEARCH_PRIORITIES:
      (config.research_priorities as string[] | undefined)?.join("\n") ??
      "(see experiment research hints)",
  });

  // Parse planner output into sections
  const { approachA, approachB, approachC, planSummary } =
    parsePlannerOutput(planOutput);

  // Validate each approach doc against experiment.changeableFiles
  validateApproachDoc("a", approachA, experiment.changeableFiles);
  validateApproachDoc("b", approachB, experiment.changeableFiles);
  validateApproachDoc("c", approachC, experiment.changeableFiles);

  // Write outputs
  const docA = approachA || planOutput;
  const docB = approachB || "(no approach B parsed)";
  const docC = approachC || "(no approach C parsed)";
  writeFileSync(join(outDir, "approach-a.md"), docA);
  writeFileSync(join(outDir, "approach-b.md"), docB);
  writeFileSync(join(outDir, "approach-c.md"), docC);
  writeFileSync(summaryPath, planSummary || planOutput);

  console.log(`[phase-2] ✎ Plan — 3 approaches selected:`);
  console.log(
    `[phase-2]   A: ${extractApproachTitle(docA).padEnd(50)}  → ${experiment.name}`
  );
  console.log(
    `[phase-2]   B: ${extractApproachTitle(docB).padEnd(50)}  → ${experiment.name}`
  );
  console.log(
    `[phase-2]   C: ${extractApproachTitle(docC).padEnd(50)}  → ${experiment.name}`
  );
  console.log(`[phase-2]   approach-a.md: ${join(outDir, "approach-a.md")}`);
  console.log(`[phase-2]   approach-b.md: ${join(outDir, "approach-b.md")}`);
  console.log(`[phase-2]   approach-c.md: ${join(outDir, "approach-c.md")}`);
  console.log(`[phase-2]   plan-summary.md: ${summaryPath}`);
}

main().catch((err) => {
  console.error("[phase-2] Fatal error:", err);
  process.exit(1);
});
