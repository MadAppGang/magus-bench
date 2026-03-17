#!/usr/bin/env bun
/**
 * Phase 1: Research
 * Spawns 3 parallel research agents (methodology, prompts/rubrics, structure)
 * and writes their briefs to loop/iteration-N/research/
 *
 * Now experiment-agnostic: reads contextFiles, changeableFiles, researchHints,
 * and dependentVariables from the active experiment plugin, and injects them
 * into agent templates as generic variables.
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

function readFileOrEmpty(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function readPreviousRejectedCandidates(
  loopDir: string,
  iteration: number
): string {
  if (iteration <= 1) return "(none — first iteration)";
  const prevDecisionPath = join(
    loopDir,
    `iteration-${iteration - 1}`,
    "decision",
    "decision-summary.json"
  );
  if (!existsSync(prevDecisionPath)) return "(no prior decision found)";
  try {
    const summary = JSON.parse(readFileSync(prevDecisionPath, "utf-8")) as {
      dropped?: string[];
    };
    const dropped = summary.dropped ?? [];
    if (dropped.length === 0)
      return "(all approaches merged — no rejected candidates)";
    return `Dropped approaches from iteration ${iteration - 1}: ${dropped.join(", ")}`;
  } catch {
    return "(could not read prior decision summary)";
  }
}

function readLastJournalEntries(loopDir: string, count: number): string {
  const journalPath = join(loopDir, "journal.md");
  if (!existsSync(journalPath)) return "(no journal yet — first iteration)";
  const content = readFileSync(journalPath, "utf-8");
  // Split on iteration headers
  const sections = content.split(/\n---\n/).filter((s) => s.trim());
  const last = sections.slice(-count);
  if (last.length === 0) return "(journal is empty)";
  return last.join("\n\n---\n\n");
}

function readFullJournal(loopDir: string): string {
  const journalPath = join(loopDir, "journal.md");
  if (!existsSync(journalPath)) return "(no journal yet)";
  return readFileSync(journalPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Brief summary extraction
// ---------------------------------------------------------------------------

/**
 * Extract the first meaningful title line from a research brief.
 * Prefers the first line starting with '#', falls back to the first non-empty line.
 */
function extractBriefTitle(content: string): string {
  const lines = content.split("\n");
  // Prefer the first line starting with '#'
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return trimmed
        .replace(/^#+\s*/, "")
        .trim()
        .slice(0, 100);
    }
  }
  // Fallback: first non-empty line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 100);
  }
  return "(empty brief)";
}

// ---------------------------------------------------------------------------
// Dry-run stubs
// ---------------------------------------------------------------------------

function makeDryRunBriefA(
  iteration: number,
  experimentName: string,
  changeableFiles: string[]
): string {
  return `# Research Brief — Agent A (Methodology) [DRY RUN]

**Iteration**: ${iteration}
**Experiment**: ${experimentName}

## Proposed Improvements

### 1. Increase sample size for statistical power
- **Files**: ${changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: More data points improve statistical test power
- **Expected impact**: Lower Friedman p / higher pass rate
- **Risk**: medium

### 2. Improve diversity in evaluation methodology
- **Files**: ${changeableFiles[1] ?? changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: Diverse evaluators reduce systematic bias
- **Expected impact**: Reduced variance in metrics
- **Risk**: low

(dry-run brief — no agent invoked)
`;
}

function makeDryRunBriefB(
  iteration: number,
  experimentName: string,
  changeableFiles: string[]
): string {
  return `# Research Brief — Agent B (Prompts/Rubrics) [DRY RUN]

**Iteration**: ${iteration}
**Experiment**: ${experimentName}

## Proposed Improvements

### 1. Strengthen criteria specificity
- **Files**: ${changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: More precise rubric anchors reduce variance
- **Expected impact**: Metric delta +0.1 to +0.2
- **Risk**: low

### 2. Add chain-of-thought instruction
- **Files**: ${changeableFiles[1] ?? changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: CoT reasoning improves structure and completeness
- **Expected impact**: Metric delta +1 to +2
- **Risk**: low

(dry-run brief — no agent invoked)
`;
}

function makeDryRunBriefC(
  iteration: number,
  experimentName: string,
  changeableFiles: string[]
): string {
  return `# Research Brief — Agent C (Structure) [DRY RUN]

**Iteration**: ${iteration}
**Experiment**: ${experimentName}

## Proposed Improvements

### 1. Add coverage for underrepresented categories
- **Files**: ${changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: Better coverage detects improvements in edge cases
- **Expected impact**: Metric delta +0.05 to +0.10
- **Risk**: low

### 2. Restructure for better category grouping
- **Files**: ${changeableFiles[1] ?? changeableFiles[0] ?? "(see changeable files)"}
- **Mechanism**: Grouped categories allow targeted metric reporting
- **Expected impact**: Clearer signal for category-level decisions
- **Risk**: low

(dry-run brief — no agent invoked)
`;
}

// ---------------------------------------------------------------------------
// Context file loader
// ---------------------------------------------------------------------------

function loadContextFiles(
  contextFiles: string[],
  repoRoot: string
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const relPath of contextFiles) {
    const absPath = join(repoRoot, relPath);
    result[relPath] = readFileOrEmpty(absPath);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-1] Starting research phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "research");
  mkdirSync(outDir, { recursive: true });

  // Idempotency: if all 3 briefs already exist, exit
  const briefAPath = join(outDir, "agent-a-brief.md");
  const briefBPath = join(outDir, "agent-b-brief.md");
  const briefCPath = join(outDir, "agent-c-brief.md");

  if (
    existsSync(briefAPath) &&
    existsSync(briefBPath) &&
    existsSync(briefCPath)
  ) {
    console.log("[phase-1] All research briefs already exist — skipping");
    process.exit(0);
  }

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(LOOP_DIR);
  console.log(`[phase-1] Experiment: ${experiment.name}`);

  // Load hypothesis knowledge from registry
  const registry = new HypothesisRegistry(LOOP_DIR);
  const hypothesisKnowledge = registry.getKnowledgeSummary(10);

  if (dryRun) {
    console.log("[phase-1] Dry-run: writing stub research briefs");
    const dryA = makeDryRunBriefA(
      iteration,
      experiment.name,
      experiment.changeableFiles
    );
    const dryB = makeDryRunBriefB(
      iteration,
      experiment.name,
      experiment.changeableFiles
    );
    const dryC = makeDryRunBriefC(
      iteration,
      experiment.name,
      experiment.changeableFiles
    );
    writeFileSync(briefAPath, dryA);
    writeFileSync(briefBPath, dryB);
    writeFileSync(briefCPath, dryC);
    console.log(`[phase-1] ✎ Research complete:`);
    console.log(
      `[phase-1]   Agent A (methodology): ${extractBriefTitle(dryA)}`
    );
    console.log(`[phase-1]   Agent B (prompts):     ${extractBriefTitle(dryB)}`);
    console.log(`[phase-1]   Agent C (structure):   ${extractBriefTitle(dryC)}`);
    process.exit(0);
  }

  // Read journal context
  const journalSummary = readLastJournalEntries(LOOP_DIR, 5);
  const fullJournal = readFullJournal(LOOP_DIR);
  const baselineDisplay = await experiment.formatBaseline();

  // Read config for research priorities
  let researchPriorities: string[] = [];
  try {
    const cfg = JSON.parse(
      readFileSync(join(LOOP_DIR, "config.json"), "utf-8")
    ) as Record<string, unknown>;
    researchPriorities =
      (cfg.research_priorities as string[] | undefined) ?? [];
  } catch {
    // ignore
  }

  const prevRejected = readPreviousRejectedCandidates(LOOP_DIR, iteration);

  // Load context files for agent B (content inspection)
  const contextFileContents = loadContextFiles(
    experiment.contextFiles,
    REPO_ROOT
  );

  // Build shared variables
  const sharedVars: Record<string, string> = {
    ITERATION: String(iteration),
    EXPERIMENT_NAME: experiment.name,
    EXPERIMENT_DESCRIPTION: experiment.description,
    BASELINE_METRICS: baselineDisplay,
    JOURNAL_SUMMARY: journalSummary,
    RESEARCH_PRIORITIES:
      researchPriorities.join("\n") || "(no specific priorities set)",
    PREV_REJECTED: prevRejected,
    CHANGEABLE_FILES: experiment.changeableFiles.join("\n"),
    CONTEXT_FILES: experiment.contextFiles.join("\n"),
    RESEARCH_HINTS: experiment.researchHints.join("\n"),
    DEPENDENT_VARIABLES: experiment.dependentVariables.join(", "),
    HYPOTHESIS_KNOWLEDGE: hypothesisKnowledge,
  };

  // Build context file content vars (keyed by path for template injection)
  const contextVars: Record<string, string> = {};
  for (const [relPath, content] of Object.entries(contextFileContents)) {
    // Create a sanitized key: replace path separators and dots with underscores, uppercase
    const key = relPath
      .replace(/[/\\.-]/g, "_")
      .toUpperCase()
      .replace(/__+/g, "_");
    contextVars[`CTX_${key}`] = content;
  }

  // Template paths
  const templateA = join(LOOP_DIR, "templates", "research-methodology.md");
  const templateB = join(LOOP_DIR, "templates", "research-prompts.md");
  const templateC = join(LOOP_DIR, "templates", "research-structure.md");

  // Run 3 agents in parallel
  console.log("[phase-1] Spawning 3 research agents in parallel...");
  const [briefA, briefB, briefC] = await Promise.all([
    spawnAgent(templateA, { ...sharedVars }),
    spawnAgent(templateB, {
      ...sharedVars,
      ...contextVars,
    }),
    spawnAgent(templateC, {
      ...sharedVars,
      FULL_JOURNAL: fullJournal,
    }),
  ]);

  // Write outputs
  writeFileSync(briefAPath, briefA);
  writeFileSync(briefBPath, briefB);
  writeFileSync(briefCPath, briefC);

  console.log(`[phase-1] ✎ Research complete:`);
  console.log(
    `[phase-1]   Agent A (methodology): ${extractBriefTitle(briefA)}`
  );
  console.log(`[phase-1]   Agent B (prompts):     ${extractBriefTitle(briefB)}`);
  console.log(`[phase-1]   Agent C (structure):   ${extractBriefTitle(briefC)}`);
  console.log(`[phase-1]   Agent A brief: ${briefAPath}`);
  console.log(`[phase-1]   Agent B brief: ${briefBPath}`);
  console.log(`[phase-1]   Agent C brief: ${briefCPath}`);
}

main().catch((err) => {
  console.error("[phase-1] Fatal error:", err);
  process.exit(1);
});
