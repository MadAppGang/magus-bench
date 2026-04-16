import { join } from "node:path";

export interface WorktreeInfo {
  path: string;
  branch: string;
}

/**
 * Creates a git worktree for the given iteration and approach label.
 * Path: <worktreeBaseDir>/iteration-N-approach-<label>
 * Branch: platform/iter-N/approach-<label>
 */
export async function createWorktree(
  repoRoot: string,
  iteration: number,
  label: string,
  worktreeBaseDir = "/tmp/magus-bench-loop"
): Promise<WorktreeInfo> {
  const worktreePath = join(worktreeBaseDir, `iteration-${iteration}-approach-${label}`);
  const branch = `platform/iter-${iteration}/approach-${label}`;

  // Clean up stale directory if it exists (leftover from crashed run)
  const { existsSync } = await import("node:fs");
  if (existsSync(worktreePath)) {
    console.log(`[worktree] Removing stale directory: ${worktreePath}`);
    try {
      await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      // If git doesn't know about it, just rm the directory
      const rm = Bun.spawn(["rm", "-rf", worktreePath], { stdout: "pipe", stderr: "pipe" });
      await rm.exited;
    }
  }

  // Delete stale branch if it exists (leftover from previous iteration that wasn't cleaned)
  try {
    await runGit(repoRoot, ["branch", "-D", branch]);
    console.log(`[worktree] Deleted stale branch: ${branch}`);
  } catch {
    // Branch doesn't exist — expected for fresh runs
  }

  // Ensure base dir exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(worktreeBaseDir, { recursive: true });

  await runGit(repoRoot, ["worktree", "add", worktreePath, "-b", branch]);

  return { path: worktreePath, branch };
}

/**
 * Removes the worktree filesystem entry.
 * If keepBranch is false, also deletes the git branch.
 */
export async function removeWorktree(
  worktreePath: string,
  branch: string,
  keepBranch = false
): Promise<void> {
  // Find the repo root from the worktree (git worktree list gives us main path)
  // We'll run from /tmp since the worktree may already be gone
  try {
    // Run git worktree remove — finds the right repo automatically
    const proc = Bun.spawn(
      ["git", "worktree", "remove", "--force", worktreePath],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
  } catch { /* ignore if already removed */ }

  if (!keepBranch) {
    // We need the repo root to delete the branch
    // Try to find it from git
    try {
      const proc = Bun.spawn(
        ["git", "-C", worktreePath, "rev-parse", "--show-toplevel"],
        { stdout: "pipe", stderr: "pipe" }
      );
      const repoRoot = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      if (repoRoot) {
        await removeWorktreeBranch(repoRoot, branch);
      }
    } catch { /* ignore */ }
  }
}

/**
 * Deletes a local git branch.
 */
export async function removeWorktreeBranch(
  repoRoot: string,
  branch: string
): Promise<void> {
  try {
    const proc = Bun.spawn(
      ["git", "-C", repoRoot, "branch", "-D", branch],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
  } catch { /* ignore if branch does not exist */ }
}

/**
 * Prunes stale worktrees from crashed runs.
 * Finds all registered worktrees for this repo, removes any that are missing
 * from the filesystem or have a branch matching platform/iter-* pattern.
 */
export async function pruneStaleWorktrees(repoRoot: string): Promise<void> {
  // First run git worktree prune to clean up any deleted-path entries
  try {
    const proc = Bun.spawn(
      ["git", "-C", repoRoot, "worktree", "prune"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
  } catch { /* ignore */ }

  // List remaining worktrees and remove any platform/* worktrees
  try {
    const proc = Bun.spawn(
      ["git", "-C", repoRoot, "worktree", "list", "--porcelain"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // Parse porcelain output
    // Each entry: "worktree <path>\nHEAD <hash>\nbranch refs/heads/<branch>\n"
    const entries = output.trim().split("\n\n").filter(Boolean);
    for (const entry of entries) {
      const lines = entry.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!pathLine) continue;

      const worktreePath = pathLine.replace("worktree ", "").trim();
      const branchRef = branchLine?.replace("branch ", "").trim() ?? "";
      const branch = branchRef.replace("refs/heads/", "");

      // Skip the main worktree
      if (worktreePath === repoRoot) continue;

      // Remove stale platform/* worktrees
      if (branch.startsWith("platform/")) {
        console.log(`[worktree] Pruning stale worktree: ${worktreePath} (${branch})`);
        try {
          const rmProc = Bun.spawn(
            ["git", "-C", repoRoot, "worktree", "remove", "--force", worktreePath],
            { stdout: "pipe", stderr: "pipe" }
          );
          await rmProc.exited;
        } catch { /* ignore */ }
        // Also delete the branch
        await removeWorktreeBranch(repoRoot, branch);
      }
    }
  } catch { /* ignore */ }

  // Also clean any orphaned platform/* branches that have no worktree
  try {
    const brProc = Bun.spawn(
      ["git", "-C", repoRoot, "branch", "--list", "platform/*"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const brOutput = await new Response(brProc.stdout).text();
    await brProc.exited;
    const branches = brOutput.split("\n").map(b => b.trim().replace(/^\* /, "")).filter(Boolean);
    for (const branch of branches) {
      console.log(`[worktree] Pruning orphan branch: ${branch}`);
      await removeWorktreeBranch(repoRoot, branch);
    }
  } catch { /* ignore */ }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (code ${code}): ${stderr.trim()}`);
  }
  return stdout.trim();
}
