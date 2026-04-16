#!/usr/bin/env bun
/**
 * Phase 6: Journal
 * Reads all phase outputs for this iteration, assembles a structured
 * journal entry, appends it to platform/journal.md, commits, and writes
 * a journal-written.marker sentinel.
 *
 * Now experiment-agnostic: delegates metric formatting to the plugin
 * and uses engine/journal.ts buildJournalEntry().
 */

import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { getActiveExperiment, loadExperiment } from "../engine/plugin-registry.ts";
import { HypothesisRegistry } from "../engine/hypothesis.ts";
import {
  buildJournalEntry,
  appendToJournal as appendJournalEntry,
} from "../engine/journal.ts";
import type {
  ExperimentResult,
  ReviewerVote,
  DecisionSummary,
  Metrics,
} from "../engine/types.ts";

const REPO_ROOT = join(import.meta.dir, "../..");
const PLATFORM_DIR = join(REPO_ROOT, "platform");
const RUNS_DIR = join(PLATFORM_DIR, "runs");

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

/**
 * Extract a 1-sentence summary from a research brief.
 */
function extractBriefSummary(brief: string): string {
  const lines = brief.split("\n").filter((l) => l.trim());
  const summaryLine = lines.find(
    (l) => !l.startsWith("#") && !l.startsWith("**Iteration") && l.trim()
  );
  return summaryLine?.slice(0, 120) ?? "(no summary available)";
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
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
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
// Journal initialization
// ---------------------------------------------------------------------------

function ensureJournalHeader(experimentName: string): void {
  const journalPath = join(PLATFORM_DIR, "journal.md");
  if (!existsSync(journalPath)) {
    const header = `# Continuous Eval Improvement Loop Journal

**Repository**: ${REPO_ROOT}
**Experiment**: ${experimentName}
**Loop started**: ${nowUTC()}
**Loop config**: platform/config.json

---
`;
    writeFileSync(journalPath, header, "utf-8");
    console.log("[phase-6] Created journal.md with header");
  }
}

// ---------------------------------------------------------------------------
// Git HEAD helper
// ---------------------------------------------------------------------------

async function getGitHead(): Promise<string> {
  try {
    const proc = Bun.spawn(
      ["git", "-C", REPO_ROOT, "rev-parse", "--short", "HEAD"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const out = await new Response(proc.stdout as ReadableStream).text();
    const code = await proc.exited;
    return code === 0 ? out.trim() : "(unknown)";
  } catch {
    return "(unknown)";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-6] Starting journal phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const iterDir = join(RUNS_DIR, `iteration-${iteration}`);
  mkdirSync(iterDir, { recursive: true });

  // Idempotency
  const markerPath = join(iterDir, "journal-written.marker");
  if (existsSync(markerPath)) {
    console.log(
      "[phase-6] Journal already written for this iteration — skipping"
    );
    process.exit(0);
  }

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(PLATFORM_DIR);
  console.log(`[phase-6] Experiment: ${experiment.name}`);

  // Ensure journal header
  ensureJournalHeader(experiment.name);

  // Read all iteration phase data
  const researchDir = join(iterDir, "research");
  const planDir = join(iterDir, "plan");
  const executeDir = join(iterDir, "execute");
  const analyzeDir = join(iterDir, "analyze");
  const decisionDir = join(iterDir, "decision");

  const briefA = readFileOrEmpty(join(researchDir, "agent-a-brief.md"));
  const briefB = readFileOrEmpty(join(researchDir, "agent-b-brief.md"));
  const briefC = readFileOrEmpty(join(researchDir, "agent-c-brief.md"));

  const approachADoc = readFileOrEmpty(join(planDir, "approach-a.md"));
  const approachBDoc = readFileOrEmpty(join(planDir, "approach-b.md"));
  const approachCDoc = readFileOrEmpty(join(planDir, "approach-c.md"));

  // Extract approach titles and metadata
  function extractApproachTitle(doc: string): string {
    const m =
      doc.match(/^\*\*Title\*\*:\s*(.+)/m) ??
      doc.match(/^Title:\s*(.+)/im) ??
      doc.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
    return m?.[1]?.trim().slice(0, 80) ?? "(no title)";
  }

  function extractRisk(doc: string): string {
    const m =
      doc.match(/\*\*Risk[_\s]level\*\*:\s*(\S+)/i) ??
      doc.match(/Risk\s*(?:level)?:\s*(\S+)/i);
    return m?.[1]?.trim() ?? "unknown";
  }

  function extractExpectedDelta(doc: string): string {
    const m =
      doc.match(/\*\*Expected[^:]*delta[^:]*\*\*:\s*(.+)/i) ??
      doc.match(/Expected[^:]*delta[^:]*:\s*(.+)/i) ??
      doc.match(/Expected[^:]*effect[^:]*:\s*(.+)/i);
    return m?.[1]?.trim().slice(0, 80) ?? "(see approach doc)";
  }

  const resultA = readJSONOrNull(
    join(executeDir, "approach-a-result.json")
  ) as ExperimentResult | null;
  const resultB = readJSONOrNull(
    join(executeDir, "approach-b-result.json")
  ) as ExperimentResult | null;
  const resultC = readJSONOrNull(
    join(executeDir, "approach-c-result.json")
  ) as ExperimentResult | null;

  const voteA = readJSONOrNull(
    join(analyzeDir, "approach-a-vote.json")
  ) as ReviewerVote | null;
  const voteB = readJSONOrNull(
    join(analyzeDir, "approach-b-vote.json")
  ) as ReviewerVote | null;
  const voteC = readJSONOrNull(
    join(analyzeDir, "approach-c-vote.json")
  ) as ReviewerVote | null;

  const decision = readJSONOrNull(
    join(decisionDir, "decision-summary.json")
  ) as (DecisionSummary & { decisions?: Array<{ label: string; outcome: string; reason: string; commit_hash?: string }> } & { new_baseline?: Metrics | null }) | null;

  // Get git HEAD at start (approximate — read now since it may have changed post-merge)
  const gitHead = await getGitHead();

  // Baseline display via plugin
  const baselineDisplay = await experiment.formatBaseline();

  // Load baseline metrics for delta display
  const baselineMetrics = await experiment.readBaseline();

  // Hypothesis verdicts from registry
  const registry = new HypothesisRegistry(PLATFORM_DIR);
  const hypothesisKnowledge = registry.getKnowledgeSummary(5);

  // Merge commits map
  const mergeCommits: Record<string, string> = {};
  if (decision?.decisions) {
    for (const d of decision.decisions) {
      if (d.outcome === "merge" && d.commit_hash) {
        mergeCommits[d.label] = d.commit_hash;
      }
    }
  }

  // Build the journal entry using engine/journal.ts generic builder
  const executeResults: ExperimentResult[] = [resultA, resultB, resultC].filter(
    Boolean
  ) as ExperimentResult[];
  const votes: ReviewerVote[] = [voteA, voteB, voteC].filter(
    Boolean
  ) as ReviewerVote[];

  const entry = buildJournalEntry(
    iteration,
    {
      iteration,
      startedAt: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
      gitHead,
      baselineMetricsSummary: baselineDisplay,
      researchSummaries: {
        a: extractBriefSummary(briefA),
        b: extractBriefSummary(briefB),
        c: extractBriefSummary(briefC),
      },
      approaches: [
        {
          label: "a",
          title: extractApproachTitle(approachADoc),
          risk: extractRisk(approachADoc),
          expectedDelta: extractExpectedDelta(approachADoc),
        },
        {
          label: "b",
          title: extractApproachTitle(approachBDoc),
          risk: extractRisk(approachBDoc),
          expectedDelta: extractExpectedDelta(approachBDoc),
        },
        {
          label: "c",
          title: extractApproachTitle(approachCDoc),
          risk: extractRisk(approachCDoc),
          expectedDelta: extractExpectedDelta(approachCDoc),
        },
      ],
      executeResults,
      baselineMetrics,
      votes,
      decision: decision
        ? {
            iteration,
            merged: decision.merged ?? [],
            dropped: decision.dropped ?? [],
            all_dropped: decision.all_dropped ?? true,
            new_baseline: decision.new_baseline ?? null,
            decided_at: decision.decided_at ?? new Date().toISOString(),
          }
        : undefined,
      mergeCommits,
    },
    experiment
  );

  // Add hypothesis verdicts section
  const hypothesisSection = `\n### Hypothesis Registry\n\n${hypothesisKnowledge}\n`;
  const fullEntry = entry + hypothesisSection;

  // Append to journal.md
  appendJournalEntry(PLATFORM_DIR, fullEntry);

  const mergedCount = decision?.merged?.length ?? 0;
  const droppedCount = decision?.dropped?.length ?? 0;
  console.log(
    `[phase-6] Journal updated — iteration ${iteration} appended (merged: ${mergedCount}, dropped: ${droppedCount})`
  );
  console.log(
    `[phase-6] Appended iteration ${iteration} entry to ${join(PLATFORM_DIR, "journal.md")}`
  );

  if (!dryRun) {
    // Commit journal.md to git (FR-6.1)
    const journalPath = join(PLATFORM_DIR, "journal.md");
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
