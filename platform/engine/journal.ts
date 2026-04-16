// platform/engine/journal.ts
// Experiment-agnostic journal builder.
// All metric display delegates to plugin.formatMetrics() and plugin.formatDelta().

import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import type {
  ExperimentResult,
  ReviewerVote,
  DecisionSummary,
  Metrics,
  Experiment,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Phase data interface
// ---------------------------------------------------------------------------

/**
 * All data collected across an iteration's phases, passed to buildJournalEntry.
 */
export interface IterationPhaseData {
  iteration: number;
  startedAt: string;
  gitHead: string;
  /** Pre-formatted baseline summary (from plugin.formatBaseline()) */
  baselineMetricsSummary: string;

  // Phase 1
  researchSummaries?: {
    a: string;
    b: string;
    c: string;
  };

  // Phase 2
  approaches?: Array<{
    label: string;
    title: string;
    risk: string;
    expectedDelta: string;
  }>;
  rejectedSuggestions?: string;

  // Phase 3
  executeResults?: ExperimentResult[];
  /** Baseline metrics at the start of the iteration for delta display */
  baselineMetrics?: Metrics | null;

  // Phase 4
  votes?: ReviewerVote[];

  // Phase 5
  decision?: DecisionSummary;
  mergeCommits?: Record<string, string>;

  // Cumulative (optional; populated when history is available)
  metricsHistory?: Array<{ iteration: number; metrics: Metrics }>;
}

// ---------------------------------------------------------------------------
// Journal entry builder
// ---------------------------------------------------------------------------

/**
 * Build a full journal entry for one iteration.
 * Uses plugin.formatMetrics() and plugin.formatDelta() for all metric display.
 * Format matches the existing journal.md structure.
 *
 * @param iteration  Iteration number
 * @param data       Phase data collected during the iteration
 * @param plugin     Active experiment plugin (for metric formatting)
 */
export function buildJournalEntry(
  iteration: number,
  data: IterationPhaseData,
  plugin: Experiment
): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("");
  lines.push(`## Iteration ${iteration} — ${data.startedAt}`);
  lines.push("");
  lines.push(`**Git HEAD at start**: ${data.gitHead}`);
  lines.push(`**Baseline at start**:`);
  lines.push(data.baselineMetricsSummary);
  lines.push("");

  // Phase 1: Research
  if (data.researchSummaries) {
    const rs = data.researchSummaries;
    lines.push(`### Phase 1: Research`);
    lines.push("");
    lines.push(`**Agent A**: ${rs.a}`);
    lines.push(`Full brief: platform/runs/iteration-${iteration}/research/agent-a-brief.md`);
    lines.push("");
    lines.push(`**Agent B**: ${rs.b}`);
    lines.push(`Full brief: platform/runs/iteration-${iteration}/research/agent-b-brief.md`);
    lines.push("");
    lines.push(`**Agent C**: ${rs.c}`);
    lines.push(`Full brief: platform/runs/iteration-${iteration}/research/agent-c-brief.md`);
    lines.push("");
  }

  // Phase 2: Plan
  if (data.approaches) {
    lines.push(`### Phase 2: Plan`);
    lines.push("");
    lines.push(`| # | Title | Risk | Expected Delta |`);
    lines.push(`|---|-------|------|----------------|`);
    for (const a of data.approaches) {
      lines.push(
        `| ${a.label.toUpperCase()} | ${a.title} | ${a.risk} | ${a.expectedDelta} |`
      );
    }
    lines.push("");
    if (data.rejectedSuggestions) {
      lines.push(`Rejected suggestions: ${data.rejectedSuggestions}`);
    }
    lines.push(`Full plan: platform/runs/iteration-${iteration}/plan/plan-summary.md`);
    lines.push("");
  }

  // Phase 3: Execute
  if (data.executeResults) {
    lines.push(`### Phase 3: Execute`);
    lines.push("");
    lines.push(`| Approach | Status | Primary Metrics | Baseline Delta |`);
    lines.push(`|----------|--------|-----------------|----------------|`);

    for (const r of data.executeResults) {
      const metricsStr = formatMetricsShort(r.metrics, plugin);
      const deltaStr = formatDeltaShort(r.metrics, data.baselineMetrics ?? null, plugin);
      lines.push(
        `| ${r.label.toUpperCase()} | ${r.status} | ${metricsStr} | ${deltaStr} |`
      );
    }
    lines.push("");

    // Error details
    for (const r of data.executeResults) {
      if (r.status === "error" && r.error) {
        lines.push(
          `Error details (${r.label.toUpperCase()}): ${r.error.slice(0, 200)}`
        );
      }
      if (r.status === "isolation_failed" && r.isolationViolation) {
        const unexpected = r.isolationViolation.unexpectedFiles.join(", ");
        lines.push(
          `Isolation violation (${r.label.toUpperCase()}): unexpected files changed: ${unexpected}`
        );
      }
    }

    lines.push(`Results archived: platform/runs/iteration-${iteration}/execute/results/`);
    lines.push("");
  }

  // Phase 4: Analyze
  if (data.votes) {
    lines.push(`### Phase 4: Analyze`);
    lines.push("");
    lines.push(`| Approach | Vote | Confidence | Auto-dropped | Key Concerns |`);
    lines.push(`|----------|------|------------|--------------|--------------|`);
    for (const v of data.votes) {
      const label = (v as { label?: string; approach?: string }).label ??
        (v as { approach?: string }).approach ?? "?";
      const concerns = v.concerns.slice(0, 1).join("; ") || "—";
      lines.push(
        `| ${label.toUpperCase()} | ${v.vote} | ${v.confidence} | ${v.auto_dropped ? "yes" : "no"} | ${concerns} |`
      );
    }
    lines.push(`Full votes: platform/runs/iteration-${iteration}/analyze/`);
    lines.push("");
  }

  // Phase 5: Decision
  if (data.decision) {
    const d = data.decision;
    lines.push(`### Phase 5: Decision`);
    lines.push("");

    if (d.merged.length > 0) {
      lines.push(`**Merged**:`);
      for (const label of d.merged) {
        const commit = data.mergeCommits?.[label] ?? "unknown";
        lines.push(
          `- platform/runs/iter-${iteration}/approach-${label} → commit ${commit}`
        );
      }
    }

    if (d.dropped.length > 0) {
      lines.push(`**Dropped**:`);
      for (const label of d.dropped) {
        const result = data.executeResults?.find((r) => r.label === label);
        const reason = result?.error ?? result?.status ?? "decision";
        lines.push(
          `- platform/runs/iter-${iteration}/approach-${label} (${reason})`
        );
      }
    }

    lines.push("");

    if (d.new_baseline) {
      lines.push(`**New baseline captured**: ${plugin.formatMetrics(d.new_baseline)}`);
      lines.push("");
    }
  }

  // Cumulative metrics
  if (data.metricsHistory && data.metricsHistory.length > 0) {
    lines.push(`### Cumulative Metrics`);
    lines.push("");
    lines.push(`| Iteration | Metrics |`);
    lines.push(`|-----------|---------|`);
    for (const entry of data.metricsHistory) {
      lines.push(
        `| ${entry.iteration} | ${plugin.formatMetrics(entry.metrics)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Journal I/O
// ---------------------------------------------------------------------------

/**
 * Append an entry to the journal file at platform/journal.md.
 */
export function appendToJournal(loopDir: string, entry: string): void {
  const journalPath = join(loopDir, "journal.md");
  appendFileSync(journalPath, "\n" + entry + "\n", "utf-8");
}

/**
 * Read the last N iteration blocks from the journal.
 * Returns an empty string if the journal doesn't exist.
 */
export function readLastJournalEntries(loopDir: string, count: number): string {
  const journalPath = join(loopDir, "journal.md");
  if (!existsSync(journalPath)) return "";

  const content = readFileSync(journalPath, "utf-8");
  // Split on "## Iteration " markers to get individual blocks
  const blocks = content
    .split(/^(?=## Iteration \d+)/m)
    .filter((b) => b.trim().startsWith("## Iteration"));

  return blocks.slice(-count).join("\n");
}

/**
 * Read the full journal content.
 */
export function readFullJournal(loopDir: string): string {
  const journalPath = join(loopDir, "journal.md");
  if (!existsSync(journalPath)) return "";
  return readFileSync(journalPath, "utf-8");
}

// ---------------------------------------------------------------------------
// Formatting helpers (delegates to plugin)
// ---------------------------------------------------------------------------

function formatMetricsShort(
  metrics: Metrics | null,
  plugin: Experiment
): string {
  if (!metrics) return "—";
  return plugin.formatMetrics(metrics);
}

function formatDeltaShort(
  current: Metrics | null,
  baseline: Metrics | null,
  plugin: Experiment
): string {
  if (!current || !baseline) return "—";
  return plugin.formatDelta(current, baseline);
}
