/**
 * agent-routing experiment plugin
 *
 * Migrates all skill-routing-eval specific logic from loop/lib/metrics.ts,
 * loop/lib/decision.ts, and loop/phases/phase-3-execute.ts into this plugin.
 *
 * Eval harness: npx promptfoo@0.103.5 eval -c skill-routing-eval/promptfooconfig.yaml
 * Baseline storage: skill-routing-eval/results/latest.json
 */

import { join } from "node:path";
import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import type { Experiment, Metrics } from "../../engine/types.ts";

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "../..");
const EVAL_DIR = join(REPO_ROOT, "skill-routing-eval");
const RESULTS_DIR = join(EVAL_DIR, "results");
const BASELINE_PATH = join(RESULTS_DIR, "latest.json");

// ---------------------------------------------------------------------------
// Idle-watchdog shell spawner
// (same pattern as loop/phases/phase-3-execute.ts spawnShell)
// ---------------------------------------------------------------------------

interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min of silence = hung

async function spawnShell(
  args: string[],
  options: {
    cwd?: string;
    allowFailure?: boolean;
    env?: Record<string, string | undefined>;
    idleTimeout?: number;
  } = {}
): Promise<ShellResult> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: options.env as Record<string, string> | undefined,
  });

  const idleMs = options.idleTimeout ?? IDLE_TIMEOUT_MS;
  let lastActivity = Date.now();
  let idleKilled = false;

  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > idleMs) {
      idleKilled = true;
      const idleSec = Math.round((Date.now() - lastActivity) / 1000);
      console.error(
        `[watchdog] No output for ${idleSec}s — killing: ${args.slice(0, 3).join(" ")}`
      );
      proc.kill("SIGTERM");
      clearInterval(watchdog);
    }
  }, 30_000);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const readStream = async (
    stream: ReadableStream<Uint8Array> | null,
    chunks: string[]
  ): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lastActivity = Date.now();
      chunks.push(decoder.decode(value, { stream: true }));
    }
  };

  await Promise.all([
    readStream(proc.stdout as ReadableStream<Uint8Array>, stdoutChunks),
    readStream(proc.stderr as ReadableStream<Uint8Array>, stderrChunks),
  ]);

  const code = await proc.exited;
  clearInterval(watchdog);

  const stdout = stdoutChunks.join("");
  const stderr = stderrChunks.join("");

  if (idleKilled) {
    throw new Error(
      `Process idle-killed after ${idleMs / 1000}s of no output: ${args.join(" ")}\nstderr: ${stderr.slice(0, 500)}`
    );
  }

  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `Command failed (code ${code}): ${args.join(" ")}\nstderr: ${stderr.slice(0, 1000)}`
    );
  }

  return { code, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Promptfoo results parser
// ---------------------------------------------------------------------------

interface ParsedSRMetrics {
  pass_rate: number;
  passed: number;
  total: number;
  failed_test_ids: string[];
}

function parsePromptfooResults(data: Record<string, unknown>): ParsedSRMetrics {
  // Promptfoo output structure: top-level has .results which is an object
  // containing .stats and .results array, OR results may be at top-level
  const resultsObj = (data.results as Record<string, unknown>) ?? data;
  const stats = resultsObj.stats as Record<string, unknown> | undefined;

  let passed = 0;
  let failed = 0;
  const failedTestIds: string[] = [];

  if (
    stats &&
    typeof stats.successes === "number" &&
    typeof stats.failures === "number"
  ) {
    passed = stats.successes;
    failed = stats.failures;

    // Extract failed test IDs from the results array
    const tests = resultsObj.results as
      | Array<Record<string, unknown>>
      | undefined;
    if (tests) {
      for (const t of tests) {
        if (!t.success) {
          const vars = t.vars as Record<string, unknown> | undefined;
          const id = vars?.id ?? vars?.test_id ?? t.testIdx ?? "unknown";
          failedTestIds.push(String(id));
        }
      }
    }
  } else {
    // Fallback: scan top-level results array
    const allResults = data.results as Array<Record<string, unknown>> | undefined;
    if (allResults) {
      for (const r of allResults) {
        if (r.success) {
          passed++;
        } else {
          failed++;
          const vars = r.vars as Record<string, unknown> | undefined;
          const id = vars?.id ?? vars?.test_id ?? r.testIdx ?? "unknown";
          failedTestIds.push(String(id));
        }
      }
    }
  }

  const total = passed + failed;
  const pass_rate = total > 0 ? passed / total : 0;

  return { pass_rate, passed, total, failed_test_ids: failedTestIds };
}

function readAndParse(filePath: string): ParsedSRMetrics | null {
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<
      string,
      unknown
    >;
    return parsePromptfooResults(data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal metric helpers
// ---------------------------------------------------------------------------

function numDelta(
  current: Metrics,
  baseline: Metrics,
  key: string
): number | null {
  const c = current[key];
  const b = baseline[key];
  if (typeof c !== "number" || typeof b !== "number") return null;
  return Math.round((c - b) * 10000) / 10000;
}

function metricsFromParsed(parsed: ParsedSRMetrics): Metrics {
  return {
    pass_rate: parsed.pass_rate,
    passed: parsed.passed,
    total: parsed.total,
    // Store failed IDs as a JSON string so they fit the Metrics value type
    failed_test_ids: JSON.stringify(parsed.failed_test_ids),
  };
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const plugin = {
  name: "agent-routing",
  description:
    "Evaluates skill-tool vs task-tool routing accuracy and CLAUDE.md routing table adherence",

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  async run(worktreePath: string, outputDir: string): Promise<Metrics> {
    const configPath = join(
      worktreePath,
      "skill-routing-eval",
      "promptfooconfig.yaml"
    );
    const latestPath = join(
      worktreePath,
      "skill-routing-eval",
      "results",
      "latest.json"
    );

    mkdirSync(outputDir, { recursive: true });

    const result = await spawnShell(
      [
        "npx",
        "promptfoo@0.103.5",
        "eval",
        "-c",
        configPath,
        "--no-progress-bar",
      ],
      {
        cwd: worktreePath,
        allowFailure: true,
        env: {
          ...process.env,
          PROMPTFOO_DISABLE_TELEMETRY: "1",
        },
        idleTimeout: IDLE_TIMEOUT_MS,
      }
    );

    // Exit code 100 = promptfoo telemetry shutdown timeout.
    // Treat as success if results were written.
    if (result.code !== 0 && result.code !== 100) {
      throw new Error(
        `promptfoo eval failed (code ${result.code}): ${result.stderr.slice(0, 500)}`
      );
    }

    if (result.code === 100 && !existsSync(latestPath)) {
      throw new Error(
        `promptfoo eval failed (code 100) and no results produced: ${result.stderr.slice(0, 500)}`
      );
    }

    if (!existsSync(latestPath)) {
      throw new Error(
        `Promptfoo did not produce results/latest.json at ${latestPath}`
      );
    }

    // Copy latest.json into outputDir for artifact preservation
    copyFileSync(latestPath, join(outputDir, "latest.json"));

    const data = JSON.parse(readFileSync(latestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    const parsed = parsePromptfooResults(data);
    return metricsFromParsed(parsed);
  },

  async readBaseline(): Promise<Metrics | null> {
    const parsed = readAndParse(BASELINE_PATH);
    if (!parsed) return null;
    return metricsFromParsed(parsed);
  },

  async saveBaseline(runDir: string): Promise<void> {
    // The run artifact is stored in runDir/latest.json (copied there by run())
    const runLatest = join(runDir, "latest.json");

    // Also check the worktree's results path (fallback for direct-run case)
    const sourceFile = existsSync(runLatest) ? runLatest : BASELINE_PATH;

    if (!existsSync(sourceFile)) {
      throw new Error(
        `Cannot save baseline: no results file found at ${runLatest}`
      );
    }

    mkdirSync(RESULTS_DIR, { recursive: true });
    copyFileSync(sourceFile, BASELINE_PATH);
  },

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  isImprovement(
    current: Metrics,
    baseline: Metrics
  ): { improved: boolean; reason: string } {
    const delta = numDelta(current, baseline, "pass_rate");

    if (delta !== null && delta >= 0.05) {
      const currentPct = Math.round(Number(current.pass_rate) * 100);
      const baselinePct = Math.round(Number(baseline.pass_rate) * 100);
      return {
        improved: true,
        reason: `pass_rate +${Math.round(delta * 100)}pp (${baselinePct}% → ${currentPct}%)`,
      };
    }

    return {
      improved: false,
      reason: `pass_rate delta ${
        delta !== null
          ? `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}pp`
          : "n/a"
      } — below +5pp threshold`,
    };
  },

  isRegression(
    current: Metrics,
    baseline: Metrics
  ): { regressed: boolean; reason: string } {
    // Veto: any previously passing test now fails
    const baselineFailedRaw = baseline.failed_test_ids;
    const currentFailedRaw = current.failed_test_ids;

    let baselineFailed: string[] = [];
    let currentFailed: string[] = [];

    try {
      if (typeof baselineFailedRaw === "string") {
        baselineFailed = JSON.parse(baselineFailedRaw) as string[];
      }
      if (typeof currentFailedRaw === "string") {
        currentFailed = JSON.parse(currentFailedRaw) as string[];
      }
    } catch {
      // If we can't parse, fall back to pass_rate comparison
    }

    // Check if any previously passing tests now fail
    // Primary regression signal: previously-passing tests now fail
    // Detect by checking if a test that was passing (not in baselineFailed)
    // is now failing (in currentFailed)
    const baselineFailedSet = new Set(baselineFailed);
    const regressions = currentFailed.filter(
      (id) => !baselineFailedSet.has(id)
    );

    if (regressions.length > 0) {
      return {
        regressed: true,
        reason: `Previously passing tests now fail: ${regressions.slice(0, 5).join(", ")}${regressions.length > 5 ? `... (+${regressions.length - 5} more)` : ""}`,
      };
    }

    // Secondary: pass_rate dropped at all (even slightly)
    const delta = numDelta(current, baseline, "pass_rate");
    if (delta !== null && delta < 0) {
      return {
        regressed: true,
        reason: `Pass rate dropped ${Math.round(Math.abs(delta) * 100)}pp (${Math.round(Number(baseline.pass_rate) * 100)}% → ${Math.round(Number(current.pass_rate) * 100)}%)`,
      };
    }

    return { regressed: false, reason: "" };
  },

  // -------------------------------------------------------------------------
  // Display
  // -------------------------------------------------------------------------

  formatMetrics(metrics: Metrics): string {
    const rate = metrics["pass_rate"];
    const passed = metrics["passed"];
    const total = metrics["total"];
    if (rate == null) return "(no metrics)";
    const pct = Math.round(Number(rate) * 100);
    if (passed != null && total != null) {
      return `SR pass=${pct}% (${passed}/${total})`;
    }
    return `SR pass=${pct}%`;
  },

  formatDelta(current: Metrics, baseline: Metrics): string {
    const delta = numDelta(current, baseline, "pass_rate");
    if (delta === null) return "(no delta)";
    const pp = Math.round(delta * 100);
    return `Δ pass_rate ${pp >= 0 ? "+" : ""}${pp}%`;
  },

  async formatBaseline(): Promise<string> {
    const baseline = await plugin.readBaseline();
    if (!baseline) return "No baseline available";
    return plugin.formatMetrics(baseline);
  },

  // -------------------------------------------------------------------------
  // Research guidance
  // -------------------------------------------------------------------------

  changeableFiles: [
    "skill-routing-eval/test-cases.yaml",
    "skill-routing-eval/promptfooconfig.yaml",
  ],

  contextFiles: [
    "skill-routing-eval/promptfooconfig.yaml",
    "skill-routing-eval/test-cases.yaml",
  ],

  researchHints: [
    "The eval tests Skill tool vs Task tool disambiguation — skills must use the Skill tool.",
    "CLAUDE.md routing table entries must direct complex tasks to the right specialist.",
    "Bash commands after skill loading must spell tool names correctly (e.g. 'claudemem').",
    "Trivially simple tasks must not incur unnecessary agent delegation.",
    "Adding test cases increases coverage but may lower pass_rate if edge cases are hard.",
    "The promptfoo config uses two models (Sonnet 4.6, Haiku 4.5) — changes affect both.",
    "Exit code 100 from promptfoo is a telemetry timeout; results are still valid.",
  ],

  // -------------------------------------------------------------------------
  // Hypothesis support
  // -------------------------------------------------------------------------

  dependentVariables: ["pass_rate", "passed", "total"],
} satisfies Experiment;

export default plugin;
