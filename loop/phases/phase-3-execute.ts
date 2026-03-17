#!/usr/bin/env bun
/**
 * Phase 3: Execute
 * For each of the 3 approaches:
 *   1. Create a git worktree
 *   2. Spawn an implementer agent to apply changes
 *   3. Run the relevant eval pipeline
 *   4. Capture metrics and copy results
 *   5. Remove the worktree (keep the branch for phase-5 merge)
 * All 3 approaches run in parallel, staggered 60s apart.
 */

import { join, dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnAgent } from "../lib/agent.ts";

const REPO_ROOT = "/Users/jack/mag/magus-bench";
const LOOP_DIR = join(REPO_ROOT, "loop");
const WORKTREE_BASE = "/tmp/magus-bench-loop";
const MIN_JUDGES = 3;

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
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shell spawn helper
// ---------------------------------------------------------------------------

interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of no output = hung

async function spawnShell(
  args: string[],
  options: {
    cwd?: string;
    allowFailure?: boolean;
    env?: Record<string, string | undefined>;
    idleTimeout?: number; // ms of silence before killing (default: 10 min)
  } = {}
): Promise<ShellResult> {
  const proc = Bun.spawn(args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: options.env ?? process.env,
  });

  const idleMs = options.idleTimeout ?? IDLE_TIMEOUT_MS;
  let lastActivity = Date.now();
  let idleKilled = false;

  // Watchdog: check every 30s if we've gone idle
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > idleMs) {
      idleKilled = true;
      const idleSec = Math.round((Date.now() - lastActivity) / 1000);
      console.error(`[watchdog] No output for ${idleSec}s — killing: ${args.slice(0, 3).join(" ")}`);
      proc.kill("SIGTERM");
      clearInterval(watchdog);
    }
  }, 30_000);

  // Stream stdout/stderr, collecting output and resetting the idle timer on each chunk
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
// JSON helpers
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

// ---------------------------------------------------------------------------
// Worktree helpers
// ---------------------------------------------------------------------------

function worktreePath(iteration: number, approach: string): string {
  return join(WORKTREE_BASE, `iteration-${iteration}-approach-${approach}`);
}

function worktreeBranch(iteration: number, approach: string): string {
  return `loop/iter-${iteration}/approach-${approach}`;
}

async function createWorktree(
  iteration: number,
  approach: string
): Promise<{ path: string; branch: string }> {
  const wtPath = worktreePath(iteration, approach);
  const branch = worktreeBranch(iteration, approach);

  // Remove if already exists from a prior partial run
  if (existsSync(wtPath)) {
    await spawnShell(
      ["git", "worktree", "remove", "--force", wtPath],
      { allowFailure: true }
    );
  }

  // Delete branch if it already exists
  await spawnShell(
    ["git", "-C", REPO_ROOT, "branch", "-D", branch],
    { allowFailure: true }
  );

  mkdirSync(WORKTREE_BASE, { recursive: true });
  await spawnShell([
    "git",
    "-C",
    REPO_ROOT,
    "worktree",
    "add",
    wtPath,
    "-b",
    branch,
  ]);
  return { path: wtPath, branch };
}

async function removeWorktree(
  wtPath: string,
  keepBranch: boolean
): Promise<void> {
  if (!existsSync(wtPath)) return;
  await spawnShell(
    ["git", "-C", REPO_ROOT, "worktree", "remove", "--force", wtPath],
    { allowFailure: true }
  );
  if (!keepBranch) {
    const branch = worktreeBranch(
      0,
      dirname(wtPath).split("-approach-").pop() ?? "x"
    );
    await spawnShell(
      ["git", "-C", REPO_ROOT, "branch", "-D", branch],
      { allowFailure: true }
    );
  }
}

// ---------------------------------------------------------------------------
// Target eval parsing
// ---------------------------------------------------------------------------

type EvalTarget = "tech-writer-eval" | "skill-routing-eval" | "both";

function parseTargetEval(approachDoc: string): EvalTarget {
  const lower = approachDoc.toLowerCase();
  const hasTW = /tech-writer-eval/.test(lower);
  const hasSR = /skill-routing-eval/.test(lower);
  if (hasTW && hasSR) return "both";
  if (hasSR) return "skill-routing-eval";
  return "tech-writer-eval"; // default
}

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

interface TechWriterMetrics {
  weighted_scores: Record<string, number>;
  borda_counts: Record<string, number>;
  friedman_p: number | null;
  bootstrap_ci: Record<string, [number, number]> | null;
  successful_judges: number;
}

interface SkillRoutingMetrics {
  pass_rate: number;
  total_tests: number;
  passed: number;
  failed: number;
  failed_test_ids: string[];
}

// ---------------------------------------------------------------------------
// Baseline loading
// ---------------------------------------------------------------------------

function readTWBaseline(): TechWriterMetrics | null {
  const path = join(
    REPO_ROOT,
    "tech-writer-eval",
    "baselines",
    "latest",
    "scores.json"
  );
  if (!existsSync(path)) return null;
  try {
    return readJSON(path) as TechWriterMetrics;
  } catch {
    return null;
  }
}

function readSRBaseline(): SkillRoutingMetrics | null {
  const path = join(REPO_ROOT, "skill-routing-eval", "results", "latest.json");
  if (!existsSync(path)) return null;
  try {
    return parsePromptfooResults(path);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metrics parsing
// ---------------------------------------------------------------------------

function parseTechWriterBenchmark(reportPath: string): TechWriterMetrics {
  const report = readJSON(reportPath) as Record<string, unknown>;
  const weighted = (report.weighted_scores ?? {}) as Record<string, number>;
  const borda = (report.borda_counts ?? {}) as Record<string, number>;
  const statTests = report.statistical_tests as Record<string, unknown> | undefined;
  const friedman_p =
    statTests && "friedman_p" in statTests
      ? (statTests.friedman_p as number)
      : null;
  const bootstrap_ci =
    (report.bootstrap_ci as Record<string, [number, number]> | null) ?? null;
  // Count successful judges from judge_results if present
  const judgeResults = report.judge_results as Record<string, unknown>[] | undefined;
  const successful_judges = judgeResults
    ? judgeResults.filter((j) => j.status === "success").length
    : 7; // assume full success if not present
  return { weighted_scores: weighted, borda_counts: borda, friedman_p, bootstrap_ci, successful_judges };
}

function parsePromptfooResults(resultsPath: string): SkillRoutingMetrics {
  const data = readJSON(resultsPath) as Record<string, unknown>;
  // promptfoo results structure
  const results = (data.results as Record<string, unknown>) ?? data;
  const stats = results.stats as Record<string, unknown> | undefined;

  if (stats) {
    const successes = (stats.successes as number) ?? 0;
    const failures = (stats.failures as number) ?? 0;
    const total = successes + failures;
    const pass_rate = total > 0 ? successes / total : 0;

    // Extract failed test IDs
    const tests = results.results as Array<Record<string, unknown>> | undefined;
    const failed_test_ids: string[] = [];
    if (tests) {
      for (const t of tests) {
        if (!t.success) {
          const vars = t.vars as Record<string, unknown> | undefined;
          const id = vars?.id ?? t.testIdx ?? "unknown";
          failed_test_ids.push(String(id));
        }
      }
    }

    return {
      pass_rate,
      total_tests: total,
      passed: successes,
      failed: failures,
      failed_test_ids,
    };
  }

  // Fallback: scan top-level results array
  const allResults = data.results as Array<Record<string, unknown>> | undefined;
  if (allResults) {
    const passed = allResults.filter((r) => r.success).length;
    const total = allResults.length;
    return {
      pass_rate: total > 0 ? passed / total : 0,
      total_tests: total,
      passed,
      failed: total - passed,
      failed_test_ids: allResults
        .filter((r) => !r.success)
        .map((r) => String((r.vars as Record<string, unknown>)?.id ?? "unknown")),
    };
  }

  return { pass_rate: 0, total_tests: 0, passed: 0, failed: 0, failed_test_ids: [] };
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

function computeTWDeltas(
  metrics: TechWriterMetrics,
  baseline: TechWriterMetrics
): Record<string, number> {
  const deltas: Record<string, number> = {};
  const twKey = "techwriter";
  if (metrics.weighted_scores[twKey] !== undefined && baseline.weighted_scores[twKey] !== undefined) {
    deltas.techwriter_weighted =
      metrics.weighted_scores[twKey] - baseline.weighted_scores[twKey];
  }
  if (metrics.borda_counts[twKey] !== undefined && baseline.borda_counts[twKey] !== undefined) {
    deltas.techwriter_borda =
      metrics.borda_counts[twKey] - baseline.borda_counts[twKey];
  }
  if (metrics.friedman_p !== null && baseline.friedman_p !== null) {
    deltas.friedman_p_delta = metrics.friedman_p - baseline.friedman_p;
  }
  return deltas;
}

function computeSRDeltas(
  metrics: SkillRoutingMetrics,
  baseline: SkillRoutingMetrics
): Record<string, number> {
  return {
    pass_rate_delta: metrics.pass_rate - baseline.pass_rate,
  };
}

// ---------------------------------------------------------------------------
// Eval runners
// ---------------------------------------------------------------------------

interface EvalRunResult {
  metrics: TechWriterMetrics | SkillRoutingMetrics;
  regressionDetected: boolean;
  runDir: string;
}

async function runTechWriterEval(
  wtPath: string,
  runDirName: string,
  dryRun: boolean
): Promise<EvalRunResult> {
  const runScript = join(wtPath, "tech-writer-eval", "run.sh");
  const outputDir = join(wtPath, "tech-writer-eval", "results", runDirName);

  if (dryRun) {
    // Return mock metrics
    const baseline = readTWBaseline();
    const metrics: TechWriterMetrics = {
      weighted_scores: baseline?.weighted_scores ?? {
        techwriter: 8.3,
        default: 7.9,
        reference: 8.0,
        gemini: 7.8,
      },
      borda_counts: baseline?.borda_counts ?? {
        techwriter: 15,
        default: 10,
        reference: 8,
        gemini: 9,
      },
      friedman_p: 0.66,
      bootstrap_ci: null,
      successful_judges: 7,
    };
    return { metrics, regressionDetected: false, runDir: outputDir };
  }

  const args = [
    "bash",
    runScript,
    "--output-dir",
    outputDir,
    "--compare-baseline",
  ];

  const result = await spawnShell(args, {
    cwd: wtPath,
    allowFailure: true,
    env: { ...process.env, CLAUDECODE: undefined },
    // Smart watchdog: kills only if no output for 10 min (default)
  });

  // code 1 = regression detected (compare-baseline exits 1)
  // code 143 = killed by SIGTERM (timeout) — treat as error, not regression
  // code >1 = real failure
  const regressionDetected = result.code === 1;
  if (result.code > 1) {
    const hint = result.code === 143
      ? " (SIGTERM — likely timeout. The eval run exceeded the time limit.)"
      : "";
    throw new Error(
      `tech-writer-eval run.sh failed with code ${result.code}${hint}. stderr: ${result.stderr.slice(0, 500)}`
    );
  }

  const reportPath = join(outputDir, "report", "tech-writer-benchmark.json");
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found at ${reportPath}`);
  }

  const metrics = parseTechWriterBenchmark(reportPath);

  if (metrics.successful_judges < MIN_JUDGES) {
    const err = new Error(
      `Degraded: only ${metrics.successful_judges} judges succeeded (min ${MIN_JUDGES})`
    );
    (err as Error & { degraded: boolean }).degraded = true;
    throw err;
  }

  return { metrics, regressionDetected, runDir: outputDir };
}

async function runSkillRoutingEval(
  wtPath: string,
  dryRun: boolean
): Promise<EvalRunResult> {
  const configPath = join(wtPath, "skill-routing-eval", "promptfooconfig.yaml");
  const latestPath = join(wtPath, "skill-routing-eval", "results", "latest.json");

  // Preserve baseline before promptfoo overwrites it
  if (existsSync(latestPath)) {
    copyFileSync(latestPath, latestPath + ".pre-run");
  }

  if (!dryRun) {
    const result = await spawnShell(
      ["npx", "promptfoo@0.103.5", "eval", "-c", configPath, "--no-progress-bar"],
      { cwd: wtPath, allowFailure: true, env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1" } }
    );
    // code 100 = promptfoo telemetry shutdown timeout — if results exist, treat as success
    if (result.code !== 0 && result.code !== 100) {
      throw new Error(`promptfoo eval failed (code ${result.code}): ${result.stderr.slice(0, 500)}`);
    }
    if (result.code === 100 && !existsSync(latestPath)) {
      throw new Error(`promptfoo eval failed (code 100) and no results produced: ${result.stderr.slice(0, 500)}`);
    }
  }

  if (!existsSync(latestPath)) {
    if (dryRun) {
      const baseline = readSRBaseline();
      const metrics: SkillRoutingMetrics = baseline ?? {
        pass_rate: 0.77,
        total_tests: 22,
        passed: 17,
        failed: 5,
        failed_test_ids: [],
      };
      return { metrics, regressionDetected: false, runDir: dirname(latestPath) };
    }
    throw new Error(`Promptfoo results not found at ${latestPath}`);
  }

  const metrics = parsePromptfooResults(latestPath);
  return { metrics, regressionDetected: false, runDir: dirname(latestPath) };
}

// ---------------------------------------------------------------------------
// Results copying
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory from src to dest.
 * Skips files larger than 5MB (per C-12).
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const s = statSync(srcPath);
    if (s.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (s.size <= 5 * 1024 * 1024) {
      // Skip large files
      copyFileSync(srcPath, destPath);
    } else {
      console.log(`[phase-3] Skipping large file (${(s.size / 1024 / 1024).toFixed(1)}MB): ${srcPath}`);
    }
  }
}

async function copyEvalResults(
  wtPath: string,
  destDir: string,
  targetEval: EvalTarget,
  runDirName: string
): Promise<void> {
  if (targetEval === "tech-writer-eval" || targetEval === "both") {
    const runDir = join(wtPath, "tech-writer-eval", "results", runDirName);
    const reportDir = join(runDir, "report");
    if (existsSync(reportDir)) {
      copyDirRecursive(reportDir, join(destDir, "report"));
    }
  }
  if (targetEval === "skill-routing-eval" || targetEval === "both") {
    const latestPath = join(wtPath, "skill-routing-eval", "results", "latest.json");
    if (existsSync(latestPath)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(latestPath, join(destDir, "skill-routing-latest.json"));
    }
  }
}

// ---------------------------------------------------------------------------
// Human-readable result formatting
// ---------------------------------------------------------------------------

/**
 * Format TW metrics into a compact summary string.
 * e.g. "techwriter=8.5 borda=16 friedman_p=0.44"
 */
function formatTWMetrics(metrics: TechWriterMetrics): string {
  const parts: string[] = [];
  const tw = metrics.weighted_scores?.techwriter;
  const borda = metrics.borda_counts?.techwriter;
  const fp = metrics.friedman_p;
  if (tw != null) parts.push(`techwriter=${tw.toFixed(1)}`);
  if (borda != null) parts.push(`borda=${borda}`);
  if (fp != null) parts.push(`friedman_p=${fp.toFixed(2)}`);
  return parts.join(" ") || "(no metrics)";
}

/**
 * Format SR metrics into a compact summary string.
 * e.g. "pass_rate=86% (19/22)"
 */
function formatSRMetrics(metrics: SkillRoutingMetrics): string {
  const pct = Math.round(metrics.pass_rate * 100);
  return `pass_rate=${pct}% (${metrics.passed}/${metrics.total_tests})`;
}

/**
 * Format baseline deltas as a compact string.
 * e.g. "weighted +0.2, borda +1, p -0.22"
 */
function formatDeltas(
  deltas: Record<string, number> | null,
  targetEval: string
): string {
  if (!deltas) return "(no delta)";
  const parts: string[] = [];
  if (targetEval === "tech-writer-eval" || targetEval === "both") {
    if (deltas.techwriter_weighted != null)
      parts.push(`weighted ${deltas.techwriter_weighted >= 0 ? "+" : ""}${deltas.techwriter_weighted.toFixed(2)}`);
    if (deltas.techwriter_borda != null)
      parts.push(`borda ${deltas.techwriter_borda >= 0 ? "+" : ""}${deltas.techwriter_borda}`);
    if (deltas.friedman_p_delta != null && !isNaN(deltas.friedman_p_delta))
      parts.push(`p ${deltas.friedman_p_delta >= 0 ? "+" : ""}${deltas.friedman_p_delta.toFixed(2)}`);
  }
  if (targetEval === "skill-routing-eval") {
    if (deltas.pass_rate_delta != null)
      parts.push(`pass_rate ${deltas.pass_rate_delta >= 0 ? "+" : ""}${Math.round(deltas.pass_rate_delta * 100)}%`);
  }
  return parts.join(", ") || "0";
}

/**
 * Truncate an error message to a short snippet suitable for terminal display.
 */
function shortError(err: string | null): string {
  if (!err) return "(unknown error)";
  // Strip leading whitespace/newlines, take first 80 chars
  return err.replace(/^\s+/, "").split("\n")[0].slice(0, 80);
}

// ---------------------------------------------------------------------------
// ApproachResult type
// ---------------------------------------------------------------------------

interface ApproachResult {
  approach: "a" | "b" | "c";
  iteration: number;
  worktree_path: string | null;
  branch: string | null;
  target_eval: EvalTarget | "unknown";
  run_dir: string | null;
  status: "success" | "error" | "degraded";
  error: string | null;
  metrics: TechWriterMetrics | SkillRoutingMetrics | null;
  baseline_deltas: Record<string, number> | null;
  regression_detected: boolean;
}

// ---------------------------------------------------------------------------
// Core approach execution
// ---------------------------------------------------------------------------

async function executeApproach(
  label: "a" | "b" | "c",
  approachDoc: string,
  iteration: number,
  executeDir: string,
  dryRun: boolean
): Promise<ApproachResult> {
  const resultPath = join(executeDir, `approach-${label}-result.json`);

  // Idempotency: if result already exists, return it
  if (existsSync(resultPath)) {
    console.log(`[phase-3] Approach ${label} result already exists — skipping`);
    return readJSON(resultPath) as ApproachResult;
  }

  let worktree: { path: string; branch: string } | null = null;
  const targetEval = parseTargetEval(approachDoc);
  const runDirName = `run-iter${iteration}${label}-${Date.now()}`;

  try {
    if (!dryRun) {
      // 1. Create git worktree
      console.log(`[phase-3] Creating worktree for approach ${label}...`);
      worktree = await createWorktree(iteration, label);

      // 2. Spawn implementer agent
      console.log(`[phase-3] Running implementer agent for approach ${label}...`);
      const templatePath = join(LOOP_DIR, "templates", "implementer.md");
      await spawnAgent(
        templatePath,
        {
          APPROACH_DOC: approachDoc,
          WORKTREE_PATH: worktree.path,
          ITERATION: String(iteration),
          APPROACH: label.toUpperCase(),
        },
        { cwd: worktree.path, timeout: 300_000 }
      );
    } else {
      // Dry-run: create a minimal worktree structure so eval can proceed
      worktree = {
        path: worktreePath(iteration, label),
        branch: worktreeBranch(iteration, label),
      };
      console.log(`[phase-3] Dry-run: skipping worktree creation for approach ${label}`);
    }

    // 3. Run eval pipeline
    console.log(`[phase-3] Running ${targetEval} eval for approach ${label}...`);
    let twEvalResult: EvalRunResult | null = null;
    let srEvalResult: EvalRunResult | null = null;

    const effectiveWtPath = dryRun ? REPO_ROOT : worktree.path;

    if (targetEval === "tech-writer-eval" || targetEval === "both") {
      twEvalResult = await runTechWriterEval(effectiveWtPath, runDirName, dryRun);
    }
    if (targetEval === "skill-routing-eval" || targetEval === "both") {
      srEvalResult = await runSkillRoutingEval(effectiveWtPath, dryRun);
    }

    // 4. Determine combined metrics
    let combinedMetrics: TechWriterMetrics | SkillRoutingMetrics;
    let regressionDetected = false;

    if (twEvalResult && srEvalResult) {
      // "both" — store TW metrics as primary, merge SR data
      combinedMetrics = {
        ...(twEvalResult.metrics as TechWriterMetrics),
        sr_pass_rate: (srEvalResult.metrics as SkillRoutingMetrics).pass_rate,
      } as TechWriterMetrics;
      regressionDetected = twEvalResult.regressionDetected;
    } else if (twEvalResult) {
      combinedMetrics = twEvalResult.metrics as TechWriterMetrics;
      regressionDetected = twEvalResult.regressionDetected;
    } else if (srEvalResult) {
      combinedMetrics = srEvalResult.metrics as SkillRoutingMetrics;
      regressionDetected = srEvalResult.regressionDetected;
    } else {
      throw new Error("No eval result produced");
    }

    // 5. Copy eval results to main repo before worktree removal
    const destDir = join(executeDir, "results", `approach-${label}`);
    mkdirSync(destDir, { recursive: true });
    if (!dryRun) {
      await copyEvalResults(worktree.path, destDir, targetEval, runDirName);
    }

    // 6. Compute deltas vs baseline
    let baselineDeltas: Record<string, number> | null = null;
    if (targetEval === "tech-writer-eval" || targetEval === "both") {
      const twBaseline = readTWBaseline();
      if (twBaseline && twEvalResult) {
        baselineDeltas = computeTWDeltas(
          twEvalResult.metrics as TechWriterMetrics,
          twBaseline
        );
      }
    }
    if (targetEval === "skill-routing-eval" && srEvalResult) {
      const srBaseline = readSRBaseline();
      if (srBaseline) {
        baselineDeltas = computeSRDeltas(
          srEvalResult.metrics as SkillRoutingMetrics,
          srBaseline
        );
      }
    }

    const result: ApproachResult = {
      approach: label,
      iteration,
      worktree_path: worktree.path,
      branch: worktree.branch,
      target_eval: targetEval,
      run_dir: runDirName,
      status: "success",
      error: null,
      metrics: combinedMetrics,
      baseline_deltas: baselineDeltas,
      regression_detected: regressionDetected,
    };

    writeFileSync(resultPath, JSON.stringify(result, null, 2));

    // Human-readable result summary
    const regrStr = result.regression_detected ? " regression=yes" : " regression=no";
    console.log(`[phase-3] ✓ Approach ${label.toUpperCase()}: success`);
    if (targetEval === "tech-writer-eval" || targetEval === "both") {
      const twM = (twEvalResult?.metrics as TechWriterMetrics | undefined);
      if (twM) console.log(`[phase-3]     TW: ${formatTWMetrics(twM)}${regrStr}`);
    }
    if (targetEval === "skill-routing-eval" || targetEval === "both") {
      const srM = (srEvalResult?.metrics as SkillRoutingMetrics | undefined);
      if (srM) console.log(`[phase-3]     SR: ${formatSRMetrics(srM)}${regrStr}`);
    }
    if (result.baseline_deltas) {
      console.log(`[phase-3]     Δ baseline: ${formatDeltas(result.baseline_deltas, targetEval)}`);
    }

    return result;

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isDegraded =
      err instanceof Error &&
      "degraded" in err &&
      (err as Error & { degraded: boolean }).degraded === true;

    console.error(`[phase-3] Approach ${label} failed: ${errMsg}`);

    const result: ApproachResult = {
      approach: label,
      iteration,
      worktree_path: worktree?.path ?? null,
      branch: worktree?.branch ?? null,
      target_eval: targetEval,
      run_dir: null,
      status: isDegraded ? "degraded" : "error",
      error: errMsg,
      metrics: null,
      baseline_deltas: null,
      regression_detected: false,
    };

    writeFileSync(resultPath, JSON.stringify(result, null, 2));

    // Human-readable error summary
    console.log(`[phase-3] ✗ Approach ${label.toUpperCase()}: ${result.status}`);
    console.log(`[phase-3]     ${shortError(result.error)}`);

    return result;

  } finally {
    // Always remove worktree, but keep the branch (needed for phase-5 merge)
    if (worktree && !dryRun && existsSync(worktree.path)) {
      await removeWorktree(worktree.path, true /* keepBranch */);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { iteration, dryRun } = parseArgs(process.argv.slice(2));
  console.log(
    `[phase-3] Starting execute phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const planDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");
  mkdirSync(executeDir, { recursive: true });

  // Read approach documents
  const approaches: Array<{ label: "a" | "b" | "c"; doc: string }> = [];
  for (const label of ["a", "b", "c"] as const) {
    const approachPath = join(planDir, `approach-${label}.md`);
    if (!existsSync(approachPath)) {
      console.error(`[phase-3] Missing approach document: ${approachPath}`);
      process.exit(1);
    }
    approaches.push({ label, doc: readFileSync(approachPath, "utf-8") });
  }

  // Run all 3 approaches in parallel, staggered 60s apart
  console.log("[phase-3] Starting 3 approach executions (staggered 60s apart)...");
  const results = await Promise.all(
    approaches.map(({ label, doc }, idx) =>
      sleep(idx * 60_000).then(() => {
        console.log(`[phase-3] Starting approach ${label} (delay: ${idx * 60}s)`);
        return executeApproach(label, doc, iteration, executeDir, dryRun);
      })
    )
  );

  // Summary table
  console.log(`[phase-3] ── Execute Summary ──────────────────────────────`);
  for (const result of results) {
    const icon = result.status === "success" ? "✓" : "✗";
    const label = result.approach.toUpperCase();
    if (result.status === "success" && result.metrics) {
      const isTV = result.target_eval === "tech-writer-eval" || result.target_eval === "both";
      const isSR = result.target_eval === "skill-routing-eval" || result.target_eval === "both";
      let metricStr = "";
      if (isTV) {
        const twM = result.metrics as TechWriterMetrics;
        const tw = twM.weighted_scores?.techwriter;
        const borda = twM.borda_counts?.techwriter;
        metricStr = `TW weighted=${tw != null ? tw.toFixed(1) : "?"} borda=${borda ?? "?"}`;
      } else if (isSR) {
        const srM = result.metrics as SkillRoutingMetrics;
        metricStr = `SR pass=${Math.round(srM.pass_rate * 100)}%`;
      }
      const deltaStr = result.baseline_deltas
        ? `Δ${formatDeltas(result.baseline_deltas, result.target_eval)}`
        : "";
      console.log(`[phase-3]   ${label}: ${icon} success  ${metricStr.padEnd(32)} ${deltaStr}`);
    } else {
      console.log(`[phase-3]   ${label}: ${icon} ${result.status}    ${shortError(result.error)}`);
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const degradedCount = results.filter((r) => r.status === "degraded").length;
  console.log(
    `[phase-3] Execute complete for iteration ${iteration}: ${successCount} success, ${errorCount} error, ${degradedCount} degraded`
  );
}

main().catch((err) => {
  console.error("[phase-3] Fatal error:", err);
  process.exit(1);
});
