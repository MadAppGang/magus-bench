import { join } from "node:path";
import { readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";

export interface SpawnAgentOptions {
  cwd?: string;
  timeout?: number; // milliseconds, default 300_000
}

/**
 * Reads a template file, replaces {{VAR}} placeholders with provided values,
 * then pipes the rendered prompt to `claude -p` via stdin and returns stdout.
 * Never throws — returns error text on failure.
 */
export async function spawnAgent(
  templatePath: string,
  vars: Record<string, string>,
  options: SpawnAgentOptions = {}
): Promise<string> {
  const timeout = options.timeout ?? 300_000;

  let templateContent: string;
  try {
    templateContent = readFileSync(templatePath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[agent error] Failed to read template ${templatePath}: ${msg}`;
  }

  // Replace all {{VAR}} placeholders
  let prompt = templateContent;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value ?? "");
  }

  try {
    // Pipe the rendered prompt to claude -p via stdin
    const proc = Bun.spawn(["claude", "-p"], {
      cwd: options.cwd,
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Race against timeout
    const timeoutHandle = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
    }, timeout);

    let stdout = "";
    let stderr = "";
    try {
      stdout = await new Response(proc.stdout).text();
      stderr = await new Response(proc.stderr).text();
      await proc.exited;
    } finally {
      clearTimeout(timeoutHandle);
    }

    const code = proc.exitCode;
    if (code !== 0) {
      return `[agent error] claude -p exited with code ${code}. stderr: ${stderr.slice(0, 500)}`;
    }

    return stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[agent error] Spawn failed: ${msg}`;
  }
}
