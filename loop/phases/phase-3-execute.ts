#!/usr/bin/env bun
/**
 * Phase 3: Execute
 * For each of the 3 approaches:
 *   1. Create a git worktree
 *   2. Spawn an implementer agent to apply changes
 *   3. Run the experiment plugin (experiment.run())
 *   4. Verify isolation (verifyIsolation)
 *   5. Copy results
 *   6. Remove the worktree (keep the branch for phase-5 merge)
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
import { getActiveExperiment, loadExperiment } from "../engine/plugin-registry.ts";
import { verifyIsolation } from "../engine/diff-verifier.ts";
import type { Experiment, ExperimentResult, Metrics } from "../engine/types.ts";
import { RegressionError } from "../experiments/tech-writer-quality/experiment.ts";

const REPO_ROOT = "/Users/jack/mag/magus-bench";
const LOOP_DIR = join(REPO_ROOT, "loop");
const WORKTREE_BASE = "/tmp/magus-bench-loop";

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
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shell spawn helper (for git worktree operations and implementer agent)
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
    stdout: "pipe",
    stderr: "pipe",
    env: options.env ?? process.env,
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

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function readJSON(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf-8"));
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
// Results copying
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory from src to dest.
 * Skips files larger than 5MB.
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
      copyFileSync(srcPath, destPath);
    } else {
      console.log(
        `[phase-3] Skipping large file (${(s.size / 1024 / 1024).toFixed(1)}MB): ${srcPath}`
      );
    }
  }
}

/**
 * Copy all files from outputDir to destDir.
 * The outputDir is whatever the plugin wrote its artifacts to.
 */
function copyPluginResults(outputDir: string, destDir: string): void {
  if (!existsSync(outputDir)) return;
  mkdirSync(destDir, { recursive: true });
  copyDirRecursive(outputDir, destDir);
}

// ---------------------------------------------------------------------------
// Approach label/file helpers
// ---------------------------------------------------------------------------

/**
 * Extract files declared in an approach document.
 */
function extractDeclaredFiles(approachDoc: string): string[] {
  const files: string[] = [];
  const fileMatches = approachDoc.matchAll(
    /^[-*]\s+`?([^\s`\n]+\.[a-z][a-zA-Z0-9]*[^`\s]*)`?/gim
  );
  for (const m of fileMatches) {
    if (m[1] && !m[1].startsWith("#") && m[1].includes("/")) {
      files.push(m[1].trim());
    }
  }
  return files;
}

/**
 * Extract approach title.
 */
function extractApproachTitle(doc: string): string {
  const match =
    doc.match(/^\*\*Title\*\*:\s*(.+)/m) ??
    doc.match(/^Title:\s*(.+)/im) ??
    doc.match(/^##\s+(?:Approach\s+[ABC]\s+[—–-]+\s+)?(.+)/m);
  return match?.[1]?.trim().slice(0, 80) ?? "(no title)";
}

/**
 * Truncate an error message to a short snippet suitable for terminal display.
 */
function shortError(err: string | null): string {
  if (!err) return "(unknown error)";
  return err.replace(/^\s+/, "").split("\n")[0].slice(0, 80);
}

// ---------------------------------------------------------------------------
// Core approach execution
// ---------------------------------------------------------------------------

async function executeApproach(
  label: "a" | "b" | "c",
  approachDoc: string,
  iteration: number,
  executeDir: string,
  experiment: Experiment,
  dryRun: boolean
): Promise<ExperimentResult> {
  const resultPath = join(executeDir, `approach-${label}-result.json`);

  // Idempotency: if result already exists, return it
  if (existsSync(resultPath)) {
    console.log(`[phase-3] Approach ${label} result already exists — skipping`);
    return readJSON(resultPath) as ExperimentResult;
  }

  let worktree: { path: string; branch: string } | null = null;

  // Extract declared files from approach doc for isolation check
  const declaredFiles = extractDeclaredFiles(approachDoc);

  try {
    if (!dryRun) {
      // 1. Create git worktree
      console.log(`[phase-3] Creating worktree for approach ${label}...`);
      worktree = await createWorktree(iteration, label);

      // 2. Spawn implementer agent
      console.log(
        `[phase-3] Running implementer agent for approach ${label}...`
      );
      const templatePath = join(LOOP_DIR, "templates", "implementer.md");
      await spawnAgent(
        templatePath,
        {
          APPROACH_DOC: approachDoc,
          WORKTREE_PATH: worktree.path,
          ITERATION: String(iteration),
          APPROACH: label.toUpperCase(),
          EXPERIMENT_NAME: experiment.name,
          CHANGEABLE_FILES: experiment.changeableFiles.join("\n"),
        },
        { cwd: worktree.path, timeout: 300_000 }
      );

      // 3. Verify isolation — check agent only changed declared files
      console.log(
        `[phase-3] Verifying isolation for approach ${label}...`
      );
      const isolationResult = await verifyIsolation(
        worktree.path,
        declaredFiles.length > 0 ? declaredFiles : experiment.changeableFiles,
        { alwaysAllowed: experiment.alwaysAllowedChanges }
      );

      if (!isolationResult.passed) {
        console.error(
          `[phase-3] Isolation violation for approach ${label}: unexpected files changed: ${isolationResult.unexpectedFiles.join(", ")}`
        );
        const result: ExperimentResult = {
          label,
          hypothesisId: null,
          iteration,
          worktreePath: worktree.path,
          branch: worktree.branch,
          runDir: null,
          status: "isolation_failed",
          error: `Isolation violation: unexpected files changed: ${isolationResult.unexpectedFiles.join(", ")}`,
          metrics: null,
          isolationViolation: isolationResult.violation,
          regressionDetected: false,
        };
        writeFileSync(resultPath, JSON.stringify(result, null, 2));
        console.log(
          `[phase-3] ✗ Approach ${label.toUpperCase()}: isolation_failed`
        );
        console.log(
          `[phase-3]     ${shortError(result.error)}`
        );
        return result;
      }

      if (isolationResult.missingFiles.length > 0) {
        console.warn(
          `[phase-3] Approach ${label}: declared files not changed: ${isolationResult.missingFiles.join(", ")}`
        );
      }
    } else {
      // Dry-run: use a fake worktree path (no actual worktree created)
      worktree = {
        path: worktreePath(iteration, label),
        branch: worktreeBranch(iteration, label),
      };
      console.log(
        `[phase-3] Dry-run: skipping worktree creation for approach ${label}`
      );
    }

    // 4. Run experiment plugin
    console.log(
      `[phase-3] Running ${experiment.name} eval for approach ${label}...`
    );

    const outputDir = join(executeDir, "results", `approach-${label}`);
    mkdirSync(outputDir, { recursive: true });

    let metrics: Metrics;
    let regressionDetected = false;

    if (dryRun) {
      // Dry-run: read baseline and return it as mock metrics
      const baseline = await experiment.readBaseline();
      metrics = baseline ?? { _dry_run: true };
    } else {
      try {
        metrics = await experiment.run(worktree.path, outputDir);
      } catch (err) {
        // Check for RegressionError from tech-writer plugin
        if (err instanceof RegressionError) {
          regressionDetected = true;
          metrics = err.metrics;
          console.warn(
            `[phase-3] Approach ${label}: regression detected during eval run`
          );
        } else {
          throw err;
        }
      }

      // 5. Copy plugin results to execute dir (plugin may have written to outputDir)
      copyPluginResults(outputDir, outputDir); // already in place via plugin

      // Also copy the entire outputDir snapshot to results directory
      const destDir = join(executeDir, "results", `approach-${label}`);
      if (outputDir !== destDir) {
        copyPluginResults(outputDir, destDir);
      }
    }

    const result: ExperimentResult = {
      label,
      hypothesisId: null,
      iteration,
      worktreePath: worktree.path,
      branch: worktree.branch,
      runDir: join(executeDir, "results", `approach-${label}`),
      status: "success",
      error: null,
      metrics,
      isolationViolation: null,
      regressionDetected,
    };

    writeFileSync(resultPath, JSON.stringify(result, null, 2));

    // Human-readable result summary
    const regrStr = regressionDetected ? " regression=yes" : " regression=no";
    console.log(`[phase-3] ✓ Approach ${label.toUpperCase()}: success`);
    console.log(
      `[phase-3]     ${experiment.formatMetrics(metrics)}${regrStr}`
    );

    // Show delta vs baseline if available
    const baseline = await experiment.readBaseline();
    if (baseline) {
      console.log(
        `[phase-3]     Δ baseline: ${experiment.formatDelta(metrics, baseline)}`
      );
    }

    return result;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[phase-3] Approach ${label} failed: ${errMsg}`);

    const result: ExperimentResult = {
      label,
      hypothesisId: null,
      iteration,
      worktreePath: worktree?.path ?? null,
      branch: worktree?.branch ?? null,
      runDir: null,
      status: "error",
      error: errMsg,
      metrics: null,
      isolationViolation: null,
      regressionDetected: false,
    };

    writeFileSync(resultPath, JSON.stringify(result, null, 2));

    // Human-readable error summary
    console.log(`[phase-3] ✗ Approach ${label.toUpperCase()}: error`);
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
  const { iteration, dryRun, experiment: experimentArg } = parseArgs(
    process.argv.slice(2)
  );
  console.log(
    `[phase-3] Starting execute phase for iteration ${iteration}${dryRun ? " (dry-run)" : ""}`
  );

  const planDir = join(LOOP_DIR, `iteration-${iteration}`, "plan");
  const executeDir = join(LOOP_DIR, `iteration-${iteration}`, "execute");
  mkdirSync(executeDir, { recursive: true });

  // Load experiment plugin
  const experiment = experimentArg
    ? await loadExperiment(experimentArg)
    : await getActiveExperiment(LOOP_DIR);
  console.log(`[phase-3] Experiment: ${experiment.name}`);

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
  console.log(
    "[phase-3] Starting 3 approach executions (staggered 60s apart)..."
  );
  const results = await Promise.all(
    approaches.map(({ label, doc }, idx) =>
      sleep(idx * 60_000).then(() => {
        console.log(`[phase-3] Starting approach ${label} (delay: ${idx * 60}s)`);
        return executeApproach(label, doc, iteration, executeDir, experiment, dryRun);
      })
    )
  );

  // Read baseline once for delta display
  const baseline = await experiment.readBaseline();

  // Summary table
  console.log(
    `[phase-3] ── Execute Summary ──────────────────────────────`
  );
  for (const result of results) {
    const icon = result.status === "success" ? "✓" : "✗";
    const label = result.label.toUpperCase();
    if (result.status === "success" && result.metrics) {
      const metricStr = experiment.formatMetrics(result.metrics);
      const deltaStr = baseline
        ? experiment.formatDelta(result.metrics, baseline)
        : "(no baseline)";
      console.log(
        `[phase-3]   ${label}: ${icon} success  ${metricStr.padEnd(32)} Δ${deltaStr}`
      );
    } else {
      console.log(
        `[phase-3]   ${label}: ${icon} ${result.status.padEnd(16)}  ${shortError(result.error)}`
      );
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const isolationFailedCount = results.filter(
    (r) => r.status === "isolation_failed"
  ).length;
  console.log(
    `[phase-3] Execute complete for iteration ${iteration}: ${successCount} success, ${errorCount} error, ${isolationFailedCount} isolation_failed`
  );
}

main().catch((err) => {
  console.error("[phase-3] Fatal error:", err);
  process.exit(1);
});
