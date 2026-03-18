// loop/engine/diff-verifier.ts
// Verifies that an implementer agent only changed the declared files.
// Runs `git diff --name-only HEAD` in the worktree and compares against
// the hypothesis filesToChange list (which may contain glob patterns).

import type { IsolationViolation } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerificationResult {
  /** true if no unexpected files were changed */
  passed: boolean;
  /** Files declared in the hypothesis filesToChange */
  declaredFiles: string[];
  /** Files actually changed in the worktree (git diff --name-only HEAD) */
  actualChangedFiles: string[];
  /** Files changed that were NOT declared — the violation set */
  unexpectedFiles: string[];
  /** Declared files that were NOT changed (warning only, does not fail isolation) */
  missingFiles: string[];
  /** Populated when passed === false, null when passed === true */
  violation: IsolationViolation | null;
}

// ---------------------------------------------------------------------------
// Default always-allowed file patterns (lock files, generated artifacts)
// ---------------------------------------------------------------------------

const DEFAULT_ALWAYS_ALLOWED = [
  // Lock files
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.lock",
  // Claude Code hooks/plugins write these in every session
  ".claude/.coaching/**",
  ".claude/settings.json",
  ".claude/settings.local.json",
  // Common auto-generated files
  ".gitignore",
];

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Verify that the implementer agent only changed files in the declared set.
 *
 * @param worktreePath   Absolute path to the git worktree
 * @param declaredFiles  List of file paths/globs the agent was authorized to modify
 *                       (relative to repo root)
 * @param options        Optional: additional always-allowed patterns from the plugin
 * @returns              VerificationResult — check .passed to determine if isolation holds
 */
export async function verifyIsolation(
  worktreePath: string,
  declaredFiles: string[],
  options?: { alwaysAllowed?: string[] }
): Promise<VerificationResult> {
  const actualChangedFiles = await getChangedFiles(worktreePath);
  const alwaysAllowed = [
    ...DEFAULT_ALWAYS_ALLOWED,
    ...(options?.alwaysAllowed ?? []),
  ];

  // Filter out always-allowed files from the actual changed set
  const relevantChangedFiles = actualChangedFiles.filter(
    (f) => !matchesAnyPattern(f, alwaysAllowed)
  );

  // Determine which changed files are NOT covered by any declared pattern
  const unexpectedFiles = relevantChangedFiles.filter(
    (f) => !matchesAnyPattern(f, declaredFiles)
  );

  // Determine which declared files were not actually changed (warning only)
  const missingFiles = declaredFiles.filter(
    (declared) =>
      !isGlobPattern(declared) &&
      !actualChangedFiles.some(
        (actual) => normalizePath(actual) === normalizePath(declared)
      )
  );

  const passed = unexpectedFiles.length === 0;
  const violation: IsolationViolation | null = passed
    ? null
    : {
        declaredFiles,
        actualChangedFiles,
        unexpectedFiles,
      };

  return {
    passed,
    declaredFiles,
    actualChangedFiles,
    unexpectedFiles,
    missingFiles,
    violation,
  };
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Run `git diff --name-only HEAD` in the worktree and return the file list.
 * Also captures untracked files via `git ls-files --others --exclude-standard`.
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  // Tracked file changes (modified, deleted)
  const diffProc = Bun.spawn(
    ["git", "diff", "--name-only", "HEAD"],
    {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const diffOut = await new Response(diffProc.stdout).text();
  const diffExit = await diffProc.exited;

  if (diffExit !== 0) {
    const stderr = await new Response(diffProc.stderr).text();
    throw new Error(
      `git diff --name-only HEAD failed (exit ${diffExit}): ${stderr.slice(0, 300)}`
    );
  }

  // Untracked files (new files created by the implementer)
  const untrackedProc = Bun.spawn(
    ["git", "ls-files", "--others", "--exclude-standard"],
    {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const untrackedOut = await new Response(untrackedProc.stdout).text();
  // Ignore exit code for ls-files (non-zero may just mean nothing to list)

  const changed = parseFileList(diffOut);
  const untracked = parseFileList(untrackedOut);

  // Deduplicate
  const all = new Set([...changed, ...untracked]);
  return Array.from(all);
}

function parseFileList(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Check if a file path matches any pattern in the list.
 * Patterns may be:
 * - Exact paths: "tech-writer-eval/test-cases.json"
 * - Glob patterns: "tech-writer-eval/prompts/*.md"
 * - Directory prefixes: "tech-writer-eval/prompts/"
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);
  for (const pattern of patterns) {
    if (matchesPattern(normalized, pattern)) {
      return true;
    }
  }
  return false;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern);

  // Exact match
  if (filePath === normalizedPattern) return true;

  // Directory prefix match (pattern ends with /)
  if (normalizedPattern.endsWith("/") && filePath.startsWith(normalizedPattern)) {
    return true;
  }

  // Glob pattern matching using minimatch-style logic
  if (isGlobPattern(normalizedPattern)) {
    return globMatch(filePath, normalizedPattern);
  }

  // Directory without trailing slash — treat as prefix
  if (filePath.startsWith(normalizedPattern + "/")) {
    return true;
  }

  return false;
}

/**
 * Minimal glob matching that handles the common patterns:
 * - `*` — any characters except /
 * - `**` — any characters including /
 * - `?` — single character except /
 */
function globMatch(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex special chars (except * and ?)
    .replace(/\*\*/g, "\x00")              // temporarily replace ** with placeholder
    .replace(/\*/g, "[^/]*")               // * matches anything except /
    .replace(/\x00/g, ".*")               // ** matches anything including /
    .replace(/\?/g, "[^/]");              // ? matches one non-slash char

  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(filePath);
  } catch {
    // Malformed pattern — fall back to exact match
    return filePath === pattern;
  }
}

function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("{");
}

function normalizePath(p: string): string {
  // Remove leading ./ and normalize slashes
  return p.replace(/^\.\//, "").replace(/\\/g, "/");
}
