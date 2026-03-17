import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type {
  TechWriterMetrics,
  SkillRoutingMetrics,
  TWBaselineDeltas,
  SRBaselineDeltas,
  EvalTarget,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Tech-writer eval
// ---------------------------------------------------------------------------

export interface TWEvalResult {
  metrics: TechWriterMetrics;
  regressionDetected: boolean;
}

/**
 * Run tech-writer-eval inside a worktree.
 * Calls: bash tech-writer-eval/run.sh --compare-baseline --output-dir <runDirName>
 * Returns parsed metrics and regression flag.
 */
export async function runTechWriterEval(
  worktreePath: string,
  runDirName: string,
  dryRun = false
): Promise<TWEvalResult> {
  const runSh = join(worktreePath, "tech-writer-eval", "run.sh");
  const outputDir = join(worktreePath, "tech-writer-eval", "results", runDirName);

  const args = ["bash", runSh, "--compare-baseline", "--output-dir", outputDir];
  if (dryRun) args.push("--dry-run");

  const proc = Bun.spawn(args, {
    cwd: worktreePath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  // Exit code 1 from run.sh with --compare-baseline signals regression
  const regressionDetected = exitCode === 1;

  // If dry-run, return stub metrics
  if (dryRun) {
    return {
      metrics: {
        weighted_scores: { techwriter: 0, default: 0, reference: 0, gemini: 0 },
        borda_counts: { techwriter: 0, default: 0, reference: 0, gemini: 0 },
        friedman_p: null,
        bootstrap_ci: null,
      },
      regressionDetected: false,
    };
  }

  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(
      `tech-writer-eval run.sh failed with exit code ${exitCode}. stderr: ${stderr.slice(0, 500)}`
    );
  }

  // Parse the benchmark JSON
  const reportPath = join(outputDir, "report", "tech-writer-benchmark.json");
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found at ${reportPath}. stdout: ${stdout.slice(0, 500)}`);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf-8"));
  const metrics = parseTWReport(report);

  return { metrics, regressionDetected };
}

function parseTWReport(report: Record<string, unknown>): TechWriterMetrics {
  const weighted_scores = (report.weighted_scores ?? {}) as Record<string, number>;
  const borda_counts = (report.borda_counts ?? {}) as Record<string, number>;

  const statsTests = (report.statistical_tests ?? {}) as Record<string, unknown>;
  const friedman_p =
    typeof statsTests.friedman_p === "number" ? statsTests.friedman_p : null;

  const bootstrapRaw = (report.bootstrap_ci ?? null) as Record<
    string,
    [number, number]
  > | null;

  return {
    weighted_scores,
    borda_counts,
    friedman_p,
    bootstrap_ci: bootstrapRaw,
  };
}

// ---------------------------------------------------------------------------
// Skill-routing eval
// ---------------------------------------------------------------------------

export interface SREvalResult {
  metrics: SkillRoutingMetrics;
}

/**
 * Run skill-routing-eval inside a worktree.
 * Calls: npx promptfoo eval -c skill-routing-eval/promptfooconfig.yaml
 * Preserves the baseline latest.json before running.
 */
export async function runSkillRoutingEval(
  worktreePath: string,
  dryRun = false
): Promise<SREvalResult> {
  const configPath = join(worktreePath, "skill-routing-eval", "promptfooconfig.yaml");
  const latestPath = join(worktreePath, "skill-routing-eval", "results", "latest.json");

  // Preserve pre-run copy of latest.json as the baseline
  if (existsSync(latestPath)) {
    const { copyFileSync } = await import("node:fs");
    const baselineCopy = latestPath.replace("latest.json", "pre-run-baseline.json");
    copyFileSync(latestPath, baselineCopy);
  }

  if (dryRun) {
    return {
      metrics: {
        pass_rate: 0,
        total_tests: 22,
        passed: 0,
        failed: 22,
        failed_test_ids: [],
      },
    };
  }

  const proc = Bun.spawn(
    ["npx", "promptfoo", "eval", "-c", configPath],
    {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `promptfoo eval failed with exit code ${exitCode}. stderr: ${stderr.slice(0, 500)}`
    );
  }

  if (!existsSync(latestPath)) {
    throw new Error(`Promptfoo did not produce results/latest.json at ${latestPath}`);
  }

  const results = JSON.parse(readFileSync(latestPath, "utf-8"));
  const metrics = parseSRReport(results);

  return { metrics };
}

function parseSRReport(results: Record<string, unknown>): SkillRoutingMetrics {
  // Promptfoo output structure: results.stats or results.results
  const stats = (results.stats ?? {}) as Record<string, unknown>;

  let passed = 0;
  let failed = 0;
  const failedTestIds: string[] = [];

  // Try stats first (summary)
  if (typeof stats.successes === "number" && typeof stats.failures === "number") {
    passed = stats.successes as number;
    failed = stats.failures as number;
  }

  // Gather failed test IDs from results array
  const resultsArr = (results.results ?? []) as Array<Record<string, unknown>>;
  for (const r of resultsArr) {
    const success = r.success as boolean;
    const testId =
      (r.testIdx as string) ??
      ((r.vars as Record<string, string>)?.test_id ?? "");
    if (!success && testId) {
      failedTestIds.push(String(testId));
    }
  }

  const total = passed + failed;
  const pass_rate = total > 0 ? passed / total : 0;

  return {
    pass_rate,
    total_tests: total,
    passed,
    failed,
    failed_test_ids: failedTestIds,
  };
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

export function computeDeltas(
  metrics: TechWriterMetrics | SkillRoutingMetrics,
  targetEval: EvalTarget
): TWBaselineDeltas | SRBaselineDeltas | null {
  const repoRoot = "/Users/jack/mag/magus-bench";

  if (targetEval === "tech-writer-eval") {
    const tw = metrics as TechWriterMetrics;
    const baseline = readTWBaseline(repoRoot);
    if (!baseline) return null;

    const baselineScores = (baseline.weighted_scores ?? {}) as Record<string, number>;
    const baselineBorda = (baseline.borda_counts ?? {}) as Record<string, number>;
    const baselineFriedman =
      typeof baseline.friedman_p === "number" ? (baseline.friedman_p as number) : null;

    const deltas: TWBaselineDeltas = {
      techwriter_weighted:
        tw.weighted_scores.techwriter != null && baselineScores.techwriter != null
          ? round2(tw.weighted_scores.techwriter - baselineScores.techwriter)
          : null,
      techwriter_borda:
        tw.borda_counts.techwriter != null && baselineBorda.techwriter != null
          ? tw.borda_counts.techwriter - baselineBorda.techwriter
          : null,
      friedman_p_delta:
        tw.friedman_p != null && baselineFriedman != null
          ? round2(tw.friedman_p - baselineFriedman)
          : null,
    };
    return deltas;
  }

  if (targetEval === "skill-routing-eval") {
    const sr = metrics as SkillRoutingMetrics;
    const baseline = readSRBaseline(repoRoot);
    const baselinePassRate = baseline ? parseSRReport(baseline).pass_rate : null;

    const delta: SRBaselineDeltas = {
      pass_rate_delta:
        sr.pass_rate != null && baselinePassRate != null
          ? round2(sr.pass_rate - baselinePassRate)
          : null,
    };
    return delta;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Baseline readers
// ---------------------------------------------------------------------------

export function readTWBaseline(repoRoot: string): Record<string, unknown> | null {
  const scoresPath = join(repoRoot, "tech-writer-eval", "baselines", "latest", "scores.json");
  if (!existsSync(scoresPath)) return null;
  try {
    return JSON.parse(readFileSync(scoresPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readSRBaseline(repoRoot: string): Record<string, unknown> | null {
  const latestPath = join(repoRoot, "skill-routing-eval", "results", "latest.json");
  if (!existsSync(latestPath)) return null;
  try {
    return JSON.parse(readFileSync(latestPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Format baseline metrics as a human-readable string for agent prompts.
 */
export function formatBaselineMetrics(
  tw: Record<string, unknown> | null,
  sr: Record<string, unknown> | null
): string {
  const lines: string[] = ["## Current Baseline Metrics"];

  lines.push("\n### tech-writer-eval");
  if (tw) {
    const scores = (tw.weighted_scores ?? {}) as Record<string, number>;
    const borda = (tw.borda_counts ?? {}) as Record<string, number>;
    const friedman = tw.friedman_p ?? tw.statistical_tests;

    const friedmanP =
      typeof friedman === "number"
        ? friedman
        : typeof (friedman as Record<string, unknown>)?.friedman_p === "number"
        ? ((friedman as Record<string, unknown>).friedman_p as number)
        : null;

    lines.push(
      `- Weighted scores: ${Object.entries(scores)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(", ")}`
    );
    lines.push(
      `- Borda counts: ${Object.entries(borda)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`
    );
    if (friedmanP !== null) {
      lines.push(`- Friedman p=${friedmanP.toFixed(3)}`);
    }
  } else {
    lines.push("- No baseline available");
  }

  lines.push("\n### skill-routing-eval");
  if (sr) {
    const srMetrics = parseSRReport(sr);
    lines.push(
      `- Pass rate: ${(srMetrics.pass_rate * 100).toFixed(1)}% (${srMetrics.passed}/${srMetrics.total_tests} tests)`
    );
    if (srMetrics.failed_test_ids.length > 0) {
      lines.push(`- Failed tests: ${srMetrics.failed_test_ids.slice(0, 5).join(", ")}${srMetrics.failed_test_ids.length > 5 ? "..." : ""}`);
    }
  } else {
    lines.push("- No baseline available");
  }

  return lines.join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
