/**
 * tech-writer-quality experiment plugin
 *
 * Migrates all tech-writer-eval specific logic from loop/lib/metrics.ts,
 * loop/lib/decision.ts, and loop/phases/phase-3-execute.ts into this plugin.
 *
 * Eval harness: tech-writer-eval/run.sh
 * Baseline storage: tech-writer-eval/baselines/latest/scores.json
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { Experiment, Metrics } from "../../engine/types.ts";

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dir, "../..");
const EVAL_DIR = join(REPO_ROOT, "tech-writer-eval");
const BASELINE_DIR = join(EVAL_DIR, "baselines", "latest");

// ---------------------------------------------------------------------------
// Regression error — thrown by run() when compare-baseline.sh exits 1
// ---------------------------------------------------------------------------

export class RegressionError extends Error {
  readonly metrics: Metrics;

  constructor(metrics: Metrics, message: string) {
    super(message);
    this.name = "RegressionError";
    this.metrics = metrics;
  }
}

// ---------------------------------------------------------------------------
// Simple shell spawner — no idle timeout for eval runs.
// Eval pipelines (run.sh) legitimately run 20-40 minutes with long silent
// gaps between subprocess calls. The STOP sentinel is the abort mechanism.
// ---------------------------------------------------------------------------

interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawnShell(
  args: string[],
  options: {
    cwd?: string;
    allowFailure?: boolean;
    env?: Record<string, string | undefined>;
  } = {}
): Promise<ShellResult> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdout: "inherit",  // stream to parent terminal for visibility
    stderr: "pipe",
    env: options.env as Record<string, string> | undefined,
  });

  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0 && !options.allowFailure) {
    throw new Error(
      `Command failed (code ${code}): ${args.join(" ")}\nstderr: ${stderr.slice(0, 1000)}`
    );
  }

  return { code, stdout: "", stderr };
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
  return Math.round((c - b) * 1000) / 1000;
}

function parseReport(outputDir: string): Metrics {
  const reportPath = join(outputDir, "report", "tech-writer-benchmark.json");
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found at ${reportPath}`);
  }
  const raw = JSON.parse(readFileSync(reportPath, "utf-8")) as Record<
    string,
    unknown
  >;
  return extractMetrics(raw);
}

function tryParseReport(outputDir: string): Metrics {
  try {
    return parseReport(outputDir);
  } catch {
    return {};
  }
}

function extractMetrics(raw: Record<string, unknown>): Metrics {
  const weighted = (raw.weighted_scores ?? {}) as Record<string, number>;
  const borda = (raw.borda_counts ?? {}) as Record<string, number>;
  const stats = (raw.statistical_tests ?? {}) as Record<string, unknown>;

  // Count successful judges
  const judgeResults = raw.judge_results as
    | Array<Record<string, unknown>>
    | undefined;
  const successful_judges = judgeResults
    ? judgeResults.filter((j) => j.status === "success").length
    : typeof raw.successful_judges === "number"
    ? raw.successful_judges
    : null;

  return {
    // Primary decision metrics (named for dependentVariables)
    tech_writer_weighted: weighted.techwriter ?? null,
    tech_writer_borda: borda.techwriter ?? null,
    tech_writer_friedman_p:
      typeof stats.friedman_p === "number" ? stats.friedman_p : null,
    successful_judges,
    // Preserve all approach scores for journal detail
    ...Object.fromEntries(
      Object.entries(weighted).map(([k, v]) => [`weighted_${k}`, v])
    ),
    ...Object.fromEntries(
      Object.entries(borda).map(([k, v]) => [`borda_${k}`, v])
    ),
  };
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const plugin = {
  name: "tech-writer-quality",
  description:
    "Evaluates technical writing quality across multiple judges using Friedman/Borda statistics",

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  async run(worktreePath: string, outputDir: string): Promise<Metrics> {
    const runSh = join(worktreePath, "tech-writer-eval", "run.sh");

    const env: Record<string, string | undefined> = {
      ...process.env,
      // Prevent CLAUDECODE nesting issues (run.sh also does this, but belt+suspenders)
      CLAUDECODE: undefined,
    };

    const result = await spawnShell(
      ["bash", runSh, "--compare-baseline", "--output-dir", outputDir],
      {
        cwd: worktreePath,
        allowFailure: true,
        env,
        idleTimeout: IDLE_TIMEOUT_MS,
      }
    );

    // Exit code 1 = regression detected by compare-baseline.sh
    if (result.code === 1) {
      const partialMetrics = tryParseReport(outputDir);
      throw new RegressionError(
        partialMetrics,
        "compare-baseline.sh detected regression (exit code 1)"
      );
    }

    // Exit code 143 = SIGTERM (idle timeout); treat as hard error
    if (result.code !== 0) {
      const hint =
        result.code === 143
          ? " (SIGTERM — likely idle timeout)"
          : result.code === 137
          ? " (SIGKILL — likely OOM)"
          : "";
      throw new Error(
        `run.sh failed (exit code ${result.code}${hint}). stderr: ${result.stderr.slice(0, 500)}`
      );
    }

    return parseReport(outputDir);
  },

  async readBaseline(): Promise<Metrics | null> {
    const scoresPath = join(BASELINE_DIR, "scores.json");
    if (!existsSync(scoresPath)) return null;
    try {
      const raw = JSON.parse(readFileSync(scoresPath, "utf-8")) as Record<
        string,
        unknown
      >;
      return extractMetrics(raw);
    } catch {
      return null;
    }
  },

  async saveBaseline(runDir: string): Promise<void> {
    const captureScript = join(EVAL_DIR, "capture-baseline.sh");
    const proc = Bun.spawn(["bash", captureScript, runDir], {
      cwd: EVAL_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr as ReadableStream).text();
      throw new Error(
        `capture-baseline.sh failed (exit ${code}): ${stderr.slice(0, 300)}`
      );
    }
  },

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  isImprovement(
    current: Metrics,
    baseline: Metrics
  ): { improved: boolean; reason: string } {
    const reasons: string[] = [];
    let improved = false;

    const bordaDelta = numDelta(current, baseline, "tech_writer_borda");
    const weightedDelta = numDelta(current, baseline, "tech_writer_weighted");
    const friedmanDelta = numDelta(
      current,
      baseline,
      "tech_writer_friedman_p"
    );

    // Primary criteria: at least ONE must be met
    if (bordaDelta !== null && bordaDelta >= 1) {
      improved = true;
      reasons.push(`borda +${bordaDelta}`);
    }
    if (weightedDelta !== null && weightedDelta >= 0.1) {
      improved = true;
      reasons.push(`weighted +${weightedDelta.toFixed(2)}`);
    }
    // Friedman p decreases = signal stronger = improvement
    if (friedmanDelta !== null && friedmanDelta <= -0.05) {
      improved = true;
      reasons.push(`p ${friedmanDelta.toFixed(3)} (lower=better)`);
    }

    if (!improved) {
      reasons.push(
        `borda ${bordaDelta !== null ? bordaDelta : "n/a"}, ` +
          `weighted ${
            weightedDelta !== null ? weightedDelta.toFixed(2) : "n/a"
          }, ` +
          `p delta ${
            friedmanDelta !== null ? friedmanDelta.toFixed(3) : "n/a"
          } — below thresholds`
      );
    }

    return { improved, reason: reasons.join(", ") };
  },

  isRegression(
    current: Metrics,
    baseline: Metrics
  ): { regressed: boolean; reason: string } {
    // Veto 1: Friedman p increased > 0.10 (statistical signal weakened)
    const friedmanDelta = numDelta(
      current,
      baseline,
      "tech_writer_friedman_p"
    );
    if (friedmanDelta !== null && friedmanDelta > 0.1) {
      return {
        regressed: true,
        reason: `Friedman p rose by ${friedmanDelta.toFixed(3)} (threshold: 0.10)`,
      };
    }

    // Veto 2: Weighted score dropped > 0.5
    const weightedDelta = numDelta(current, baseline, "tech_writer_weighted");
    if (weightedDelta !== null && weightedDelta < -0.5) {
      return {
        regressed: true,
        reason: `Weighted score fell ${Math.abs(weightedDelta).toFixed(2)} points (threshold: 0.5)`,
      };
    }

    // Veto 3: Successful judge count < 4
    const judges = current.successful_judges;
    if (typeof judges === "number" && judges < 4) {
      return {
        regressed: true,
        reason: `Only ${judges} judges succeeded (minimum: 4)`,
      };
    }

    return { regressed: false, reason: "" };
  },

  // -------------------------------------------------------------------------
  // Display
  // -------------------------------------------------------------------------

  formatMetrics(metrics: Metrics): string {
    const w = metrics["tech_writer_weighted"];
    const b = metrics["tech_writer_borda"];
    const p = metrics["tech_writer_friedman_p"];
    const j = metrics["successful_judges"];
    const parts: string[] = ["TW"];
    if (w != null) parts.push(`techwriter=${Number(w).toFixed(1)}`);
    if (b != null) parts.push(`borda=${b}`);
    if (p != null) parts.push(`p=${Number(p).toFixed(2)}`);
    if (j != null) parts.push(`(${j} judges)`);
    return parts.length > 1 ? parts.join(" ") : "(no metrics)";
  },

  formatDelta(current: Metrics, baseline: Metrics): string {
    const w = numDelta(current, baseline, "tech_writer_weighted");
    const b = numDelta(current, baseline, "tech_writer_borda");
    const p = numDelta(current, baseline, "tech_writer_friedman_p");
    const parts: string[] = ["Δ"];
    if (w != null)
      parts.push(`weighted ${w >= 0 ? "+" : ""}${w.toFixed(1)}`);
    if (b != null) parts.push(`borda ${b >= 0 ? "+" : ""}${b}`);
    if (p != null) parts.push(`p ${p >= 0 ? "+" : ""}${p.toFixed(2)}`);
    return parts.length > 1 ? parts.join(", ").replace("Δ, ", "Δ ") : "(no delta)";
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
    "tech-writer-eval/prompts/*.md",
    "tech-writer-eval/test-cases.json",
    "tech-writer-eval/reference/*.md",
  ],

  contextFiles: [
    "tech-writer-eval/prompts/generate-techwriter.md",
    "tech-writer-eval/prompts/judge-template-4way.md",
    "tech-writer-eval/test-cases.json",
  ],

  researchHints: [
    "The Friedman test measures inter-judge consistency. More topics → more statistical power.",
    "Borda counts sum the judge ranking positions. Higher is better.",
    "Weighted scores are on a 1-10 scale; a delta of +0.1 is meaningful.",
    "The 'techwriter' prompt is the primary target; 'default' and 'reference' are controls.",
    "Never modify baselines/ — the engine updates the baseline after merging.",
    "Changes to the judge template affect all judges' scoring rubric simultaneously.",
    "Adding evaluation criteria to test-cases.json changes the weighted score denominator.",
    "The judge prompt ordering is randomized per-judge to prevent position bias.",
  ],

  // -------------------------------------------------------------------------
  // Hypothesis support
  // -------------------------------------------------------------------------

  dependentVariables: ["weighted_score", "borda", "friedman_p"],
} satisfies Experiment;

export default plugin;
