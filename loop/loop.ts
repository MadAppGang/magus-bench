#!/usr/bin/env bun
/**
 * loop/loop.ts — Main Orchestrator
 *
 * Sequences the 6 phase scripts in order for each iteration.
 * Manages STOP/LOCK/STALLED sentinels, handles inter-phase errors,
 * and advances the iteration counter.
 *
 * Usage:
 *   bun loop/loop.ts [--iteration N] [--resume-from-phase <name>]
 *                    [--max-iterations N] [--runs N] [--dry-run]
 *                    [--experiment <id>]
 *
 * Options:
 *   --iteration N           Start at iteration N (overrides state.json)
 *   --resume-from-phase X   Skip phases before X in the current iteration
 *   --max-iterations N      Stop after iteration N (absolute cap)
 *   --runs N                Run exactly N iterations from current position
 *   --dry-run               Stub all agent calls and eval runs
 *   --experiment <id>       Override experiment_id from config.json
 */

import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { readState, writeState } from "./lib/state.ts";
import { getActiveExperiment } from "./engine/plugin-registry.ts";
import type { Experiment } from "./engine/types.ts";
import {
  renderIterationHeader,
  renderIterationSummary,
} from "./lib/tui.ts";

const REPO_ROOT = "/Users/jack/mag/magus-bench";
const LOOP_DIR = join(REPO_ROOT, "loop");

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

interface LoopArgs {
  iteration: number | null;
  resumeFromPhase: string | null;
  maxIterations: number | null;
  runs: number | null;
  dryRun: boolean;
  experiment: string | null;
}

function parseArgs(argv: string[]): LoopArgs {
  const args: LoopArgs = {
    iteration: null,
    resumeFromPhase: null,
    maxIterations: null,
    runs: null,
    dryRun: false,
    experiment: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--iteration" && argv[i + 1]) {
      args.iteration = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--resume-from-phase" && argv[i + 1]) {
      args.resumeFromPhase = argv[i + 1];
      i++;
    } else if (argv[i] === "--max-iterations" && argv[i + 1]) {
      args.maxIterations = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--runs" && argv[i + 1]) {
      args.runs = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
    } else if (argv[i] === "--experiment" && argv[i + 1]) {
      args.experiment = argv[i + 1];
      i++;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface LoopConfig {
  stall_threshold_consecutive_iterations: number;
  max_iterations: number | null;
  estimated_cost_per_iteration_usd?: number;
  experiment_id?: string;
  success_condition: {
    friedman_p_lt?: number;
    sustained_iterations: number;
  } | null;
}

function loadConfig(): LoopConfig {
  const configPath = join(LOOP_DIR, "config.json");
  if (!existsSync(configPath)) {
    return {
      stall_threshold_consecutive_iterations: 3,
      max_iterations: null,
      success_condition: null,
    };
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as LoopConfig;
  } catch {
    console.warn("[loop] config.json parse error — using defaults");
    return {
      stall_threshold_consecutive_iterations: 3,
      max_iterations: null,
      success_condition: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Iteration outcome formatter (uses experiment plugin)
// ---------------------------------------------------------------------------

function formatIterationOutcome(
  iteration: number,
  experiment: Experiment
): string {
  const summaryPath = join(
    LOOP_DIR,
    `iteration-${iteration}`,
    "decision",
    "decision-summary.json"
  );
  if (!existsSync(summaryPath)) {
    return `Iteration ${iteration} result: (no decision summary)`;
  }

  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as {
      merged: string[];
      dropped: string[];
      new_baseline?: Record<string, unknown>;
    };
    const mergedCount = summary.merged?.length ?? 0;
    const total =
      (summary.merged?.length ?? 0) + (summary.dropped?.length ?? 0);
    // Use plugin.formatMetrics for the baseline display if available
    const baselineSuffix = summary.new_baseline
      ? `baseline now: ${experiment.formatMetrics(summary.new_baseline as Record<string, number | string | boolean | null>)}`
      : "baseline unchanged";
    return `Iteration ${iteration} result: merged ${mergedCount}/${total} approaches | ${baselineSuffix}`;
  } catch {
    return `Iteration ${iteration} result: (could not read decision summary)`;
  }
}

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

interface PhaseSpec {
  name: string;
  script: string;
  /** Sentinel file path relative to loop/iteration-N/ */
  sentinel: string;
}

const PHASES: PhaseSpec[] = [
  {
    name: "research",
    script: "phases/phase-1-research.ts",
    sentinel: "research/agent-c-brief.md",
  },
  {
    name: "plan",
    script: "phases/phase-2-plan.ts",
    sentinel: "plan/plan-summary.md",
  },
  {
    name: "execute",
    script: "phases/phase-3-execute.ts",
    sentinel: "execute/approach-c-result.json",
  },
  {
    name: "analyze",
    script: "phases/phase-4-analyze.ts",
    sentinel: "analyze/approach-c-vote.json",
  },
  {
    name: "decide",
    script: "phases/phase-5-decide.ts",
    sentinel: "decision/decision-summary.json",
  },
  {
    name: "journal",
    script: "phases/phase-6-journal.ts",
    sentinel: "journal-written.marker",
  },
];

// Map phase name → order index (for --resume-from-phase comparisons)
const PHASE_ORDER: Record<string, number> = Object.fromEntries(
  PHASES.map((p, i) => [p.name, i])
);

// ---------------------------------------------------------------------------
// Decision summary reader (for stall detection)
// ---------------------------------------------------------------------------

interface DecisionSummary {
  all_dropped: boolean;
  merged: string[];
  dropped: string[];
}

function readDecisionSummary(iteration: number): DecisionSummary | null {
  const path = join(
    LOOP_DIR,
    `iteration-${iteration}`,
    "decision",
    "decision-summary.json"
  );
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DecisionSummary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Append a simple line to journal
// ---------------------------------------------------------------------------

function appendToJournal(message: string): void {
  const journalPath = join(LOOP_DIR, "journal.md");
  const line = `\n<!-- ${new Date().toISOString()} --> ${message}\n`;
  try {
    import("node:fs").then((fs) =>
      fs.appendFileSync(journalPath, line, "utf-8")
    );
  } catch {
    // Ignore journal append failures in the orchestrator
  }
}

// ---------------------------------------------------------------------------
// Prune stale worktrees
// ---------------------------------------------------------------------------

async function pruneStaleWorktrees(): Promise<void> {
  console.log("[loop] Pruning stale worktrees...");
  const proc = Bun.spawn(["git", "-C", REPO_ROOT, "worktree", "prune"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  // Non-fatal: ignore errors
}

// ---------------------------------------------------------------------------
// Run a single phase script
// ---------------------------------------------------------------------------

async function runPhaseScript(
  scriptRelPath: string,
  iteration: number,
  dryRun: boolean,
  experimentId: string
): Promise<void> {
  const scriptPath = join(LOOP_DIR, scriptRelPath);
  const spawnArgs = [
    "bun",
    scriptPath,
    "--iteration",
    String(iteration),
    "--experiment",
    experimentId,
  ];
  if (dryRun) spawnArgs.push("--dry-run");

  console.log(`[loop] Spawning: ${spawnArgs.join(" ")}`);

  const proc = Bun.spawn(spawnArgs, {
    stdout: "inherit",
    stderr: "inherit",
    cwd: REPO_ROOT,
  });

  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Phase script ${scriptRelPath} exited with code ${code}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("[loop] Starting Continuous Eval Improvement Loop");
  console.log(`[loop] Args: ${JSON.stringify(args)}`);

  // LOCK check (FR-7.5)
  const lockPath = join(LOOP_DIR, "LOCK");
  if (existsSync(lockPath)) {
    const lockContent = readFileSync(lockPath, "utf-8").trim();
    console.error(
      `[loop] ERROR: loop/LOCK exists (started at ${lockContent}) — another loop process may be running. Remove loop/LOCK to force start.`
    );
    process.exit(1);
  }

  // Ensure loop dir exists
  mkdirSync(LOOP_DIR, { recursive: true });

  // Write LOCK
  writeFileSync(lockPath, new Date().toISOString());
  console.log(`[loop] LOCK written: ${lockPath}`);

  // Load config
  const config = loadConfig();
  const stallThreshold = config.stall_threshold_consecutive_iterations ?? 3;

  // Load experiment plugin
  // --experiment CLI arg overrides config.json experiment_id
  let experiment: Experiment;
  try {
    if (args.experiment) {
      const { loadExperiment } = await import("./engine/plugin-registry.ts");
      experiment = await loadExperiment(args.experiment);
    } else {
      experiment = await getActiveExperiment(LOOP_DIR);
    }
    console.log(`[loop] Experiment plugin loaded: ${experiment.name}`);
  } catch (err) {
    console.error("[loop] Failed to load experiment plugin:", err);
    unlinkSync(lockPath);
    process.exit(1);
  }

  const experimentId = experiment.name;

  // Effective max iterations: CLI overrides config
  let effectiveMaxIterations: number | null =
    args.maxIterations ?? config.max_iterations ?? null;

  try {
    // Prune stale worktrees from prior crashed runs
    await pruneStaleWorktrees();

    // Load state; determine starting iteration
    let state = readState(LOOP_DIR);
    let iteration = args.iteration ?? state.current_iteration ?? 1;

    // --runs N: compute effective max from starting position
    if (args.runs !== null) {
      const runsMax = iteration + args.runs - 1;
      // --runs takes precedence unless --max-iterations is lower
      if (effectiveMaxIterations === null || runsMax < effectiveMaxIterations) {
        effectiveMaxIterations = runsMax;
      }
      console.log(
        `[loop] Will run ${args.runs} iteration(s): ${iteration}..${runsMax}`
      );
    }

    console.log(`[loop] Starting at iteration ${iteration}`);

    // Show baseline at startup using plugin
    const baselineSummary = await experiment.formatBaseline();
    console.log(`[loop] ${baselineSummary}`);

    // Main loop
    while (true) {
      // Check STOP sentinel (FR-7.1)
      const stopPath = join(LOOP_DIR, "STOP");
      if (existsSync(stopPath)) {
        console.log(
          `[loop] STOP sentinel found — exiting after iteration ${iteration}`
        );
        appendToJournal(`Loop stopped by STOP file at iteration ${iteration}`);
        break;
      }

      // Check max-iterations (FR-7.4)
      if (
        effectiveMaxIterations !== null &&
        iteration > effectiveMaxIterations
      ) {
        console.log(
          `[loop] Reached max iterations (${effectiveMaxIterations}) — stopping`
        );
        break;
      }

      const iterBaseline = await experiment.formatBaseline();
      renderIterationHeader(
        iteration,
        effectiveMaxIterations,
        experiment.name,
        iterBaseline
      );

      // Ensure iteration directory exists
      mkdirSync(join(LOOP_DIR, `iteration-${iteration}`), { recursive: true });

      // Update state: mark iteration start
      state = {
        ...state,
        current_iteration: iteration,
        current_phase: "start",
      };
      writeState(LOOP_DIR, state);

      // Run all 6 phases in sequence
      for (const phase of PHASES) {
        // --resume-from-phase: skip phases before the resume point
        if (
          args.resumeFromPhase &&
          PHASE_ORDER[phase.name] !== undefined &&
          PHASE_ORDER[phase.name] < (PHASE_ORDER[args.resumeFromPhase] ?? 0)
        ) {
          console.log(
            `[loop] Skipping phase ${phase.name} (before resume point ${args.resumeFromPhase})`
          );
          continue;
        }

        // Idempotency: skip if sentinel already exists (NFR-9)
        const sentinelPath = join(
          LOOP_DIR,
          `iteration-${iteration}`,
          phase.sentinel
        );
        if (existsSync(sentinelPath)) {
          console.log(
            `[loop] Phase ${phase.name} already complete for iter ${iteration} (sentinel exists) — skipping`
          );
          continue;
        }

        // Update state: mark current phase
        state = {
          ...state,
          current_phase: phase.name,
          current_iteration: iteration,
        };
        writeState(LOOP_DIR, state);

        // Run the phase
        console.log(`[loop] Running phase: ${phase.name}`);
        try {
          await runPhaseScript(
            phase.script,
            iteration,
            args.dryRun,
            experimentId
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[loop] Phase ${phase.name} failed: ${errMsg}`);
          // Phases 1-4 failures are fatal for the iteration — stop here
          // Phase 5 and 6 failures are logged but don't abort the outer loop
          if (phase.name !== "decide" && phase.name !== "journal") {
            throw err;
          } else {
            console.warn(
              `[loop] Non-fatal phase failure (${phase.name}) — continuing`
            );
          }
        }

        // Update state: mark phase complete
        state = {
          ...state,
          last_completed_phase: phase.name,
          last_completed_phase_at: new Date().toISOString(),
        };
        writeState(LOOP_DIR, state);
      }

      // After --resume-from-phase is consumed for this iteration, clear it
      // so subsequent iterations run all phases normally
      args.resumeFromPhase = null;

      // Print iteration outcome summary
      const outcomeStr = formatIterationOutcome(iteration, experiment);
      console.log(`[loop] ${outcomeStr}`);
      // Render TUI summary
      {
        const summaryPath = join(
          LOOP_DIR,
          `iteration-${iteration}`,
          "decision",
          "decision-summary.json"
        );
        try {
          if (existsSync(summaryPath)) {
            const summaryData = JSON.parse(readFileSync(summaryPath, "utf-8")) as {
              merged?: string[];
              dropped?: string[];
              new_baseline?: Record<string, unknown>;
            };
            const mergedCount = summaryData.merged?.length ?? 0;
            const total =
              (summaryData.merged?.length ?? 0) + (summaryData.dropped?.length ?? 0);
            const baselineStr = summaryData.new_baseline
              ? experiment.formatMetrics(summaryData.new_baseline as Record<string, number | string | boolean | null>)
              : await experiment.formatBaseline();
            renderIterationSummary(iteration, mergedCount, total, baselineStr);
          }
        } catch {
          // Non-fatal: just skip the TUI summary if data is unreadable
        }
      }

      // Check stall condition (FR-5.3, FR-5.4)
      const summary = readDecisionSummary(iteration);
      if (summary?.all_dropped) {
        state = {
          ...state,
          consecutive_no_improvement_count:
            (state.consecutive_no_improvement_count ?? 0) + 1,
        };
        console.log(
          `[loop] No-improvement iteration ${iteration} (consecutive: ${state.consecutive_no_improvement_count})`
        );
      } else {
        state = { ...state, consecutive_no_improvement_count: 0 };
      }
      writeState(LOOP_DIR, state);

      if ((state.consecutive_no_improvement_count ?? 0) >= stallThreshold) {
        const stalledMsg = `Stalled after ${iteration} iterations (${stallThreshold} consecutive no-improvement iterations)`;
        writeFileSync(join(LOOP_DIR, "STALLED"), stalledMsg);
        console.error(`[loop] STALLED — ${stalledMsg}`);
        appendToJournal(`STALLED: ${stalledMsg}`);
        break;
      }

      // Check success condition (from config)
      // v1: only explicit STOP sentinel; success condition is informational
      if (config.success_condition) {
        // Could check plugin metrics here in future; skip for v1
      }

      // Advance iteration
      iteration++;
      state = {
        ...state,
        current_iteration: iteration,
        current_phase: "start",
      };
      writeState(LOOP_DIR, state);
    }
  } finally {
    // Always remove LOCK (FR-7.5)
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
      console.log("[loop] LOCK removed");
    }
  }

  console.log("[loop] Loop exited cleanly");
}

main().catch((err) => {
  console.error("[loop] Fatal error:", err);
  // Attempt to clean up LOCK
  const lockPath = join(LOOP_DIR, "LOCK");
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
  process.exit(1);
});
