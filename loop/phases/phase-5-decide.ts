#!/usr/bin/env bun
/**
 * Phase 5: Decision
 * Reads 3 votes + 3 results, runs deterministic merge/drop logic,
 * executes git merges in order A→B→C, updates baselines, removes branches.
 * Writes decision-summary.json to loop/iteration-N/decision/
 */

import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
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
  vote: "keep" | "drop" | "conditional";
  confidence: string;
  auto_dropped: boolean;
  rationale: string;
  concerns: string[];
}

interface ApproachResult {
  approach: ApproachLabel;
  iteration: number;
  branch: string | null;
  target_eval: string;
  run_dir: string | null;
  status: "success" | "error" | "degraded";
  error: string | null;
  metrics: Record<string, unknown> | null;
  baseline_deltas: Record<string, number> | null;
  regression_detected: boolean;
}

interface DecisionEntry {
  label: ApproachLabel;
  outcome: "merge" | "drop";
  reason: string;
  commit_hash?: string;
  error?: string;
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
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
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
 * Extract the approach title from the approach document or result.
 */
function parseApproachTitle(
  iteration: number,
  label: ApproachLabel
): string {
  const approachPath = join(
    LOOP_DIR,
    `iteration-${iteration}`,
    "plan",
    `approach-${label}.md`
  );
  if (!existsSync(approachPath)) return `Approach ${label.toUpperCase()}`;
  const content = readFileSync(approachPath, "utf-8");
  // Look for "Title:" or "**Title**:" line, or first ## heading
  const titleMatch =
    content.match(/^\*\*Title\*\*:\s*(.+)/m) ??
    content.match(/^Title:\s*(.+)/im) ??
    content.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
  if (titleMatch) return titleMatch[1].trim().slice(0, 80);
  return `approach-${label}`;
}

// ---------------------------------------------------------------------------
// Decision protocol (deterministic)
// ---------------------------------------------------------------------------

function determineOutcome(
  vote: ReviewerVote,
  result: ApproachResult
): { outcome: "merge" | "drop"; reason: string } {
  // Hard veto conditions
  if (result.status === "error") {
    return { outcome: "drop", reason: `Implementation error: ${result.error ?? "unknown"}` };
  }
  if (result.status === "degraded") {
    return { outcome: "drop", reason: `Degraded eval run: ${result.error ?? "insufficient judges"}` };
  }
  if (result.regression_detected) {
    return { outcome: "drop", reason: "Regression detected by compare-baseline.sh" };
  }

  // Vote tally
  if (vote.vote === "drop") {
    return { outcome: "drop", reason: `Reviewer voted drop: ${vote.rationale.slice(0, 200)}` };
  }

  // "keep" or "conditional" → merge
  const reason =
    vote.vote === "conditional"
      ? `Reviewer voted conditional (concerns carried to next iteration): ${vote.concerns.join("; ")}`
      : "Reviewer voted keep";
  return { outcome: "merge", reason };
}

// ---------------------------------------------------------------------------
// Post-merge baseline update
// ---------------------------------------------------------------------------

async function updateBaseline(
  label: ApproachLabel,
  result: ApproachResult,
  iteration: number
): Promise<void> {
  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");

  if (result.target_eval === "tech-writer-eval" || result.target_eval === "both") {
    // Run capture-baseline.sh against the saved run results
    const runResultsDir = join(executeDir, "results", `approach-${label}`);
    const captureScript = join(REPO_ROOT, "tech-writer-eval", "capture-baseline.sh");

    if (existsSync(captureScript) && existsSync(runResultsDir)) {
      console.log(`[phase-5] Updating tech-writer-eval baseline from approach-${label} results...`);
      const res = await spawnShell(
        ["bash", captureScript, runResultsDir],
        { cwd: join(REPO_ROOT, "tech-writer-eval"), allowFailure: true }
      );
      if (res.code !== 0) {
        console.warn(`[phase-5] capture-baseline.sh warning (code ${res.code}): ${res.stderr.slice(0, 300)}`);
      } else {
        console.log("[phase-5] tech-writer-eval baseline updated");
      }
    } else {
      console.warn(`[phase-5] Cannot update TW baseline: captureScript=${existsSync(captureScript)}, runResultsDir=${existsSync(runResultsDir)}`);
    }
  }

  if (result.target_eval === "skill-routing-eval" || result.target_eval === "both") {
    // Copy the saved skill-routing results as the new baseline
    const savedLatest = join(
      executeDir,
      "results",
      `approach-${label}`,
      "skill-routing-latest.json"
    );
    const baselinePath = join(REPO_ROOT, "skill-routing-eval", "results", "latest.json");

    if (existsSync(savedLatest)) {
      console.log(`[phase-5] Updating skill-routing-eval baseline from approach-${label} results...`);
      mkdirSync(join(REPO_ROOT, "skill-routing-eval", "results"), { recursive: true });
      copyFileSync(savedLatest, baselinePath);
      console.log("[phase-5] skill-routing-eval baseline updated");
    } else {
      console.warn(`[phase-5] Cannot update SR baseline: ${savedLatest} not found`);
    }
  }
}

// ---------------------------------------------------------------------------
// Validate main branch health (FR-5.2)
// ---------------------------------------------------------------------------

async function validateMainBranchHealth(): Promise<void> {
  const scoresPath = join(
    REPO_ROOT,
    "tech-writer-eval",
    "baselines",
    "latest",
    "scores.json"
  );
  if (existsSync(scoresPath)) {
    try {
      JSON.parse(readFileSync(scoresPath, "utf-8"));
      console.log("[phase-5] Main branch health check: scores.json is valid JSON");
    } catch {
      throw new Error(
        `Main branch health check failed: ${scoresPath} is not valid JSON`
      );
    }
  } else {
    console.log("[phase-5] Main branch health check: no baseline yet (skipping JSON validation)");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
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

  const mergedApproaches: ApproachLabel[] = [];
  const droppedApproaches: ApproachLabel[] = [];
  const decisions: DecisionEntry[] = [];

  // Process in order: A → B → C (FR-5.1)
  for (const label of ["a", "b", "c"] as const) {
    const votePath = join(analyzeDir, `approach-${label}-vote.json`);
    const resultPath = join(executeDir, `approach-${label}-result.json`);

    if (!existsSync(votePath)) {
      console.error(`[phase-5] Missing vote for approach ${label}: ${votePath}`);
      droppedApproaches.push(label);
      decisions.push({ label, outcome: "drop", reason: "Vote JSON not found" });
      continue;
    }
    if (!existsSync(resultPath)) {
      console.error(`[phase-5] Missing result for approach ${label}: ${resultPath}`);
      droppedApproaches.push(label);
      decisions.push({ label, outcome: "drop", reason: "Result JSON not found" });
      continue;
    }

    const vote = readJSON(votePath) as ReviewerVote;
    const result = readJSON(resultPath) as ApproachResult;

    const { outcome, reason } = determineOutcome(vote, result);
    console.log(`[phase-5] Approach ${label}: ${outcome} — ${reason}`);

    if (outcome === "merge") {
      if (dryRun) {
        console.log(`[phase-5] Dry-run: skipping git merge for approach ${label}`);
        mergedApproaches.push(label);
        decisions.push({ label, outcome: "merge", reason: `dry-run: ${reason}` });
        continue;
      }

      if (!result.branch) {
        console.error(`[phase-5] No branch for approach ${label} — treating as drop`);
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

      // Update baseline after successful merge
      await updateBaseline(label, result, iteration);

      mergedApproaches.push(label);
      decisions.push({
        label,
        outcome: "merge",
        reason,
        commit_hash: commitHash,
      });

      // Remove the branch (worktree already removed in phase-3)
      await spawnShell(
        ["git", "-C", REPO_ROOT, "branch", "-d", result.branch],
        { allowFailure: true }
      );

    } else {
      // Drop
      droppedApproaches.push(label);
      decisions.push({ label, outcome: "drop", reason });

      // Remove branch if it exists
      if (result.branch) {
        await spawnShell(
          ["git", "-C", REPO_ROOT, "branch", "-D", result.branch],
          { allowFailure: true }
        );
      }
    }
  }

  // Validate main branch health (FR-5.2)
  if (!dryRun) {
    await validateMainBranchHealth();
  }

  // Log no-improvement event (FR-5.3)
  if (mergedApproaches.length === 0) {
    console.log(
      "[phase-5] No-improvement event: all approaches dropped this iteration"
    );
  }

  // Read updated baselines for summary
  const newTWBaseline = readJSONOrNull(
    join(REPO_ROOT, "tech-writer-eval", "baselines", "latest", "scores.json")
  );
  const newSRBaseline = readJSONOrNull(
    join(REPO_ROOT, "skill-routing-eval", "results", "latest.json")
  );

  const summary: DecisionSummary = {
    iteration,
    merged: mergedApproaches,
    dropped: droppedApproaches,
    all_dropped: mergedApproaches.length === 0,
    decisions,
    new_tw_baseline: mergedApproaches.some((l) => {
      const r = readJSONOrNull(
        join(executeDir, `approach-${l}-result.json`)
      ) as ApproachResult | null;
      return r?.target_eval === "tech-writer-eval" || r?.target_eval === "both";
    })
      ? newTWBaseline
      : null,
    new_sr_baseline: mergedApproaches.some((l) => {
      const r = readJSONOrNull(
        join(executeDir, `approach-${l}-result.json`)
      ) as ApproachResult | null;
      return r?.target_eval === "skill-routing-eval" || r?.target_eval === "both";
    })
      ? newSRBaseline
      : null,
    decided_at: new Date().toISOString(),
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    `[phase-5] Decision complete for iteration ${iteration}: merged=[${mergedApproaches.join(",")}] dropped=[${droppedApproaches.join(",")}]`
  );
}

main().catch((err) => {
  console.error("[phase-5] Fatal error:", err);
  process.exit(1);
});
