#!/usr/bin/env bun
/**
 * Phase 5: Decision
 * Reads 3 votes + 3 results, runs deterministic merge/drop logic,
 * executes git merges in order A→B→C, updates baselines via plugin,
 * transitions hypothesis states, removes branches.
 * Writes decision-summary.json to loop/iteration-N/decision/
 *
 * Now experiment-agnostic: delegates baseline saving to experiment.saveBaseline()
 * and outcome determination to engine/decision.ts determineOutcome().
 */

import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { getActiveExperiment, loadExperiment } from "../engine/plugin-registry.ts";
import { HypothesisRegistry } from "../engine/hypothesis.ts";
import { determineOutcome } from "../engine/decision.ts";
import type {
  ExperimentResult,
  ReviewerVote,
  DecisionSummary,
  Metrics,
} from "../engine/types.ts";

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
      `Command failed (code ${code}): ${args.join(" ")}\nstderr: ${stderr.slice(0, 1000)}`
    );
  }
  return { code, stdout, stderr };
}

/**
 * Extract the approach title from the approach document.
 */
function parseApproachTitle(
  iteration: number,
  label: "a" | "b" | "c"
): string {
  const approachPath = join(
    LOOP_DIR,
    `iteration-${iteration}`,
    "plan",
    `approach-${label}.md`
  );
  if (!existsSync(approachPath)) return `Approach ${label.toUpperCase()}`;
  const content = readFileSync(approachPath, "utf-8");
  const titleMatch =
    content.match(/^\*\*Title\*\*:\s*(.+)/m) ??
    content.match(/^Title:\s*(.+)/im) ??
    content.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
  if (titleMatch) return titleMatch[1].trim().slice(0, 80);
  return `approach-${label}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-5] Starting decide phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const analyzeDir = join(LOOP_DIR, `iteration-${iteration}`, "analyze");
  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");
  const outDir = join(LOOP_DIR, `iteration-${iteration}`, "decision");
  mkdirSync(outDir, { recursive: true });

  // Idempotency
  const summaryPath = join(outDir, "decision-summary.json");
  if (existsSync(summaryPath)) {
    console.log("[phase-5] Decision summary already exists — skipping");
    process.exit(0);
  }

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(LOOP_DIR);
  console.log(`[phase-5] Experiment: ${experiment.name}`);

  // Load baseline metrics for comparison
  const baseline = await experiment.readBaseline();

  // Load hypothesis registry
  const registry = new HypothesisRegistry(LOOP_DIR);

  const mergedApproaches: string[] = [];
  const droppedApproaches: string[] = [];
  const mergeCommits: Record<string, string> = {};

  interface DecisionEntry {
    label: string;
    outcome: "merge" | "drop";
    reason: string;
    commit_hash?: string;
    error?: string;
    hypothesisId?: string | null;
  }
  const decisions: DecisionEntry[] = [];

  let newBaseline: Metrics | null = null;

  // Process in order: A → B → C (FR-5.1)
  for (const label of ["a", "b", "c"] as const) {
    const votePath = join(analyzeDir, `approach-${label}-vote.json`);
    const resultPath = join(executeDir, `approach-${label}-result.json`);

    if (!existsSync(votePath)) {
      console.error(
        `[phase-5] Missing vote for approach ${label}: ${votePath}`
      );
      droppedApproaches.push(label);
      decisions.push({ label, outcome: "drop", reason: "Vote JSON not found" });
      continue;
    }
    if (!existsSync(resultPath)) {
      console.error(
        `[phase-5] Missing result for approach ${label}: ${resultPath}`
      );
      droppedApproaches.push(label);
      decisions.push({
        label,
        outcome: "drop",
        reason: "Result JSON not found",
      });
      continue;
    }

    const vote = readJSON(votePath) as ReviewerVote;
    const result = readJSON(resultPath) as ExperimentResult;

    // Use generic determineOutcome from engine/decision.ts
    const { outcome, reason } = determineOutcome(vote, result, experiment);
    console.log(`[phase-5] Approach ${label}: ${outcome} — ${reason}`);

    if (outcome === "merge") {
      if (dryRun) {
        console.log(
          `[phase-5] Dry-run: skipping git merge for approach ${label}`
        );
        mergedApproaches.push(label);
        decisions.push({
          label,
          outcome: "merge",
          reason: `dry-run: ${reason}`,
          hypothesisId: result.hypothesisId,
        });

        // Transition hypothesis if linked
        if (result.hypothesisId) {
          try {
            registry.transition(result.hypothesisId, "accepted", {
              verdict: "accepted",
              explanation: reason,
              mergeCommit: null,
              resolvedAt: new Date().toISOString(),
              observedMetrics: result.metrics ?? {},
              baselineMetrics: baseline ?? {},
            });
          } catch {
            // Hypothesis may not exist in registry (e.g. dry-run)
          }
        }
        continue;
      }

      if (!result.branch) {
        console.error(
          `[phase-5] No branch for approach ${label} — treating as drop`
        );
        droppedApproaches.push(label);
        decisions.push({
          label,
          outcome: "drop",
          reason: "No git branch available for merge",
        });
        continue;
      }

      // Build merge commit message
      const title = parseApproachTitle(iteration, label);
      const mergeMsg = `loop: iter ${iteration} approach ${label} — ${title}`;

      console.log(`[phase-5] Merging branch ${result.branch}...`);
      const mergeResult = await spawnShell(
        [
          "git",
          "-C",
          REPO_ROOT,
          "merge",
          "--no-ff",
          result.branch,
          "-m",
          mergeMsg,
        ],
        { allowFailure: true }
      );

      if (mergeResult.code !== 0) {
        // Merge conflict: treat as drop, log as planning failure
        console.error(
          `[phase-5] Merge conflict on approach ${label} (planning failure): ${mergeResult.stderr.slice(0, 300)}`
        );
        // Abort any in-progress merge
        await spawnShell(
          ["git", "-C", REPO_ROOT, "merge", "--abort"],
          { allowFailure: true }
        );
        droppedApproaches.push(label);
        decisions.push({
          label,
          outcome: "drop",
          reason: `Merge conflict (planning failure): ${mergeResult.stderr.slice(0, 200)}`,
        });
        // Clean up branch
        await spawnShell(
          ["git", "-C", REPO_ROOT, "branch", "-D", result.branch],
          { allowFailure: true }
        );
        continue;
      }

      // Get the commit hash
      const headResult = await spawnShell(
        ["git", "-C", REPO_ROOT, "rev-parse", "--short", "HEAD"],
        { allowFailure: true }
      );
      const commitHash = headResult.stdout.trim();
      console.log(`[phase-5] Merged approach ${label} as commit ${commitHash}`);
      mergeCommits[label] = commitHash;

      // Update baseline via plugin (replaces hardcoded eval-specific logic)
      const runDir = result.runDir ?? join(executeDir, "results", `approach-${label}`);
      try {
        await experiment.saveBaseline(runDir);
        console.log(`[phase-5] Baseline updated via ${experiment.name}.saveBaseline()`);
        newBaseline = await experiment.readBaseline();
      } catch (err) {
        console.warn(
          `[phase-5] Warning: saveBaseline failed for approach ${label}: ${err}`
        );
      }

      // Transition hypothesis if linked
      if (result.hypothesisId) {
        try {
          registry.transition(result.hypothesisId, "accepted", {
            verdict: "accepted",
            explanation: reason,
            mergeCommit: commitHash,
            resolvedAt: new Date().toISOString(),
            observedMetrics: result.metrics ?? {},
            baselineMetrics: baseline ?? {},
          });
          console.log(
            `[phase-5] Hypothesis ${result.hypothesisId} transitioned to accepted`
          );
        } catch (err) {
          console.warn(
            `[phase-5] Warning: hypothesis transition failed: ${err}`
          );
        }
      }

      mergedApproaches.push(label);
      decisions.push({
        label,
        outcome: "merge",
        reason,
        commit_hash: commitHash,
        hypothesisId: result.hypothesisId,
      });

      // Remove the branch (worktree already removed in phase-3)
      await spawnShell(
        ["git", "-C", REPO_ROOT, "branch", "-d", result.branch],
        { allowFailure: true }
      );
    } else {
      // Drop
      droppedApproaches.push(label);
      decisions.push({ label, outcome: "drop", reason, hypothesisId: result.hypothesisId });

      // Transition hypothesis to rejected/inconclusive/isolation_failed
      if (result.hypothesisId) {
        const verdictStatus =
          result.status === "isolation_failed"
            ? "isolation_failed"
            : result.regressionDetected
            ? "rejected"
            : "inconclusive";
        try {
          registry.transition(result.hypothesisId, verdictStatus, {
            verdict: verdictStatus as "rejected" | "inconclusive" | "isolation_failed",
            explanation: reason,
            mergeCommit: null,
            resolvedAt: new Date().toISOString(),
            observedMetrics: result.metrics ?? {},
            baselineMetrics: baseline ?? {},
          });
        } catch {
          // Hypothesis may not exist
        }
      }

      // Remove branch if it exists
      if (result.branch) {
        await spawnShell(
          ["git", "-C", REPO_ROOT, "branch", "-D", result.branch],
          { allowFailure: true }
        );
      }
    }
  }

  // Log no-improvement event (FR-5.3)
  if (mergedApproaches.length === 0) {
    console.log(
      "[phase-5] No-improvement event: all approaches dropped this iteration"
    );
  }

  // Build decision summary — generic shape using engine types
  const summary: DecisionSummary & { decisions: typeof decisions; new_baseline?: Metrics | null } = {
    iteration,
    merged: mergedApproaches,
    dropped: droppedApproaches,
    all_dropped: mergedApproaches.length === 0,
    new_baseline: newBaseline,
    decided_at: new Date().toISOString(),
    decisions,
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    `[phase-5] Decision complete for iteration ${iteration}: merged=[${mergedApproaches.join(",")}] dropped=[${droppedApproaches.join(",")}]`
  );

  // Human-readable decisions summary
  console.log(
    `[phase-5] ── Decisions ────────────────────────────────────`
  );
  for (const entry of decisions) {
    const label = entry.label.toUpperCase();
    if (entry.outcome === "merge") {
      const hash = entry.commit_hash ? ` → commit ${entry.commit_hash}` : "";
      const title = parseApproachTitle(iteration, entry.label as "a" | "b" | "c");
      const mergeMsg = `loop: iter ${iteration} approach ${entry.label} — ${title}`;
      console.log(
        `[phase-5]   ${label}: ✓ MERGED${hash} "${mergeMsg.slice(0, 80)}"`
      );
    } else {
      const reason = entry.reason.slice(0, 80);
      console.log(`[phase-5]   ${label}: ✗ DROPPED — ${reason}`);
    }
  }

  // New baseline summary via plugin
  if (newBaseline) {
    console.log(
      `[phase-5] New baseline: ${experiment.formatMetrics(newBaseline)}`
    );
  } else if (mergedApproaches.length === 0) {
    console.log(`[phase-5] Baseline unchanged (no merges)`);
  }
}

main().catch((err) => {
  console.error("[phase-5] Fatal error:", err);
  process.exit(1);
});
