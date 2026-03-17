#!/usr/bin/env bun
/**
 * Phase 1: Research
 * Spawns 3 parallel research agents (methodology, prompts/rubrics, structure)
 * and writes their briefs to loop/iteration-N/research/
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
    const friedman = tw.statistical_tests as Record<string, unknown> | undefined;

    lines.push("## tech-writer-eval baseline");
    if (weighted) {
      lines.push(`- Weighted scores: ${JSON.stringify(weighted)}`);
    }
    if (borda) {
      lines.push(`- Borda counts: ${JSON.stringify(borda)}`);
    }
    if (friedman && "friedman_p" in friedman) {
      lines.push(`- Friedman p: ${friedman.friedman_p}`);
    }
  } else {
    lines.push("## tech-writer-eval baseline: NOT AVAILABLE");
  }

  lines.push("");

  if (srBaseline && typeof srBaseline === "object") {
    const sr = srBaseline as Record<string, unknown>;
    // promptfoo results/latest.json structure
    const results = (sr.results as Record<string, unknown>) ?? sr;
    const stats = results.stats as Record<string, unknown> | undefined;
    if (stats) {
      const successes = (stats.successes as number) ?? 0;
      const failures = (stats.failures as number) ?? 0;
      const total = successes + failures;
      const passRate = total > 0 ? (successes / total).toFixed(3) : "unknown";
      lines.push("## skill-routing-eval baseline");
      lines.push(`- Pass rate: ${passRate} (${successes}/${total})`);
    } else {
      lines.push("## skill-routing-eval baseline: stats not parsed");
    }
  } else {
    lines.push("## skill-routing-eval baseline: NOT AVAILABLE");
  }

  return lines.join("\n");
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
    if (dropped.length === 0) return "(all approaches merged — no rejected candidates)";
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
// Dry-run stubs
// ---------------------------------------------------------------------------

function makeDryRunBriefA(iteration: number): string {
  return `# Research Brief — Agent A (Methodology) [DRY RUN]

**Iteration**: ${iteration}

## Proposed Improvements

### 1. Add a second evaluation topic for statistical power
- **Files**: tech-writer-eval/test-cases.json
- **Mechanism**: More judge data points (14 vs 7) dramatically improves Friedman test power
- **Expected impact**: Friedman p likely to drop below 0.3
- **Risk**: Requires reference doc selection; medium effort

### 2. Increase judge diversity via temperature variation
- **Files**: tech-writer-eval/prompts/judge-template-4way.md
- **Mechanism**: Running judges at different temperatures reduces inter-judge correlation
- **Expected impact**: Bootstrap CI narrows by ~0.15
- **Risk**: May introduce inconsistency; low risk

(dry-run brief — no agent invoked)
`;
}

function makeDryRunBriefB(iteration: number): string {
  return `# Research Brief — Agent B (Prompts/Rubrics) [DRY RUN]

**Iteration**: ${iteration}

## Proposed Improvements

### 1. Strengthen criteria specificity in judge template
- **Files**: tech-writer-eval/prompts/judge-template-4way.md
- **Mechanism**: More precise rubric anchors reduce judge variance
- **Expected impact**: Weighted score delta +0.1 to +0.2
- **Risk**: Low — additive change

### 2. Add chain-of-thought instruction to generation prompt
- **Files**: tech-writer-eval/prompts/generate-techwriter.md
- **Mechanism**: CoT reasoning may improve structure and completeness
- **Expected impact**: Borda delta +1 to +2
- **Risk**: Low

(dry-run brief — no agent invoked)
`;
}

function makeDryRunBriefC(iteration: number): string {
  return `# Research Brief — Agent C (Structure) [DRY RUN]

**Iteration**: ${iteration}

## Proposed Improvements

### 1. Add skill-routing test cases for underrepresented categories
- **Files**: skill-routing-eval/test-cases.yaml
- **Mechanism**: Categories with 0% pass rate need better coverage to detect improvements
- **Expected impact**: Pass rate delta +0.05 to +0.10
- **Risk**: Low

### 2. Restructure promptfoo config for better category grouping
- **Files**: skill-routing-eval/promptfooconfig.yaml
- **Mechanism**: Grouped categories allow more targeted metric reporting
- **Expected impact**: Clearer signal for category-level decisions
- **Risk**: Low

(dry-run brief — no agent invoked)
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[phase-1] Starting research phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`);

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

  if (dryRun) {
    console.log("[phase-1] Dry-run: writing stub research briefs");
    writeFileSync(briefAPath, makeDryRunBriefA(iteration));
    writeFileSync(briefBPath, makeDryRunBriefB(iteration));
    writeFileSync(briefCPath, makeDryRunBriefC(iteration));
    console.log(`[phase-1] Research complete (dry-run) for iteration ${iteration}`);
    process.exit(0);
  }

  // Read context for agents
  const journalSummary = readLastJournalEntries(LOOP_DIR, 5);
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

  const twBaseline = readJSON(twBaselinePath);
  const srBaseline = readJSON(srBaselinePath);
  const baselineMetrics = formatBaselineMetrics(twBaseline, srBaseline);

  let generatePrompt = "";
  let judgeTemplate = "";
  let testCasesJson = "";
  let srTestCases = "";

  const generatePromptPath = join(
    REPO_ROOT,
    "tech-writer-eval",
    "prompts",
    "generate-techwriter.md"
  );
  const judgeTemplatePath = join(
    REPO_ROOT,
    "tech-writer-eval",
    "prompts",
    "judge-template-4way.md"
  );
  const testCasesPath = join(REPO_ROOT, "tech-writer-eval", "test-cases.json");
  const srTestCasesPath = join(
    REPO_ROOT,
    "skill-routing-eval",
    "test-cases.yaml"
  );

  if (existsSync(generatePromptPath)) {
    generatePrompt = readFileSync(generatePromptPath, "utf-8");
  }
  if (existsSync(judgeTemplatePath)) {
    judgeTemplate = readFileSync(judgeTemplatePath, "utf-8");
  }
  if (existsSync(testCasesPath)) {
    testCasesJson = readFileSync(testCasesPath, "utf-8");
  }
  if (existsSync(srTestCasesPath)) {
    srTestCases = readFileSync(srTestCasesPath, "utf-8");
  }

  // Read config
  const configPath = join(LOOP_DIR, "config.json");
  const config = (readJSON(configPath) ?? {}) as Record<string, unknown>;
  const researchPriorities = (config.research_priorities as string[] | undefined) ?? [];
  const prevRejected = readPreviousRejectedCandidates(LOOP_DIR, iteration);
  const fullJournal = readFullJournal(LOOP_DIR);

  const sharedVars: Record<string, string> = {
    ITERATION: String(iteration),
    BASELINE_METRICS: baselineMetrics,
    JOURNAL_SUMMARY: journalSummary,
    RESEARCH_PRIORITIES: researchPriorities.join("\n") || "(no specific priorities set)",
    PREV_REJECTED: prevRejected,
  };

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
      GENERATE_PROMPT: generatePrompt,
      JUDGE_TEMPLATE: judgeTemplate,
      TEST_CASES_JSON: testCasesJson,
      SR_TEST_CASES: srTestCases,
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

  console.log(`[phase-1] Research complete for iteration ${iteration}`);
  console.log(`[phase-1]   Agent A brief: ${briefAPath}`);
  console.log(`[phase-1]   Agent B brief: ${briefBPath}`);
  console.log(`[phase-1]   Agent C brief: ${briefCPath}`);
}

main().catch((err) => {
  console.error("[phase-1] Fatal error:", err);
  process.exit(1);
});
