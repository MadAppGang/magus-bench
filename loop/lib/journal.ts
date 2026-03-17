import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import type {
  ApproachResult,
  ReviewerVote,
  DecisionSummary,
  TechWriterMetrics,
  SkillRoutingMetrics,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Journal entry builder
// ---------------------------------------------------------------------------

export interface IterationPhaseData {
  iteration: number;
  startedAt: string;
  gitHead: string;
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
    target: string;
    risk: string;
    expectedDelta: string;
  }>;
  rejectedSuggestions?: string;

  // Phase 3
  executeResults?: ApproachResult[];

  // Phase 4
  votes?: ReviewerVote[];

  // Phase 5
  decision?: DecisionSummary;
  mergeCommits?: Record<string, string>;

  // Cumulative
  twWeightedHistory?: number[];
  twBordaHistory?: number[];
  twFriedmanHistory?: number[];
  srPassRateHistory?: number[];
}

/**
 * Build a full journal entry for one iteration in the format specified by
 * requirements section 7.3.
 */
export function buildJournalEntry(
  iteration: number,
  data: IterationPhaseData
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

  // Phase 1
  if (data.researchSummaries) {
    const rs = data.researchSummaries;
    lines.push(`### Phase 1: Research`);
    lines.push("");
    lines.push(`**Agent A (methodology)**: ${rs.a}`);
    lines.push(`Full brief: loop/iteration-${iteration}/research/agent-a-brief.md`);
    lines.push("");
    lines.push(`**Agent B (prompts/rubrics)**: ${rs.b}`);
    lines.push(`Full brief: loop/iteration-${iteration}/research/agent-b-brief.md`);
    lines.push("");
    lines.push(`**Agent C (structure/topics)**: ${rs.c}`);
    lines.push(`Full brief: loop/iteration-${iteration}/research/agent-c-brief.md`);
    lines.push("");
  }

  // Phase 2
  if (data.approaches) {
    lines.push(`### Phase 2: Plan`);
    lines.push("");
    lines.push(`| # | Title | Target | Risk | Expected Delta |`);
    lines.push(`|---|-------|--------|------|----------------|`);
    for (const a of data.approaches) {
      lines.push(
        `| ${a.label.toUpperCase()} | ${a.title} | ${a.target} | ${a.risk} | ${a.expectedDelta} |`
      );
    }
    lines.push("");
    if (data.rejectedSuggestions) {
      lines.push(`Rejected suggestions: ${data.rejectedSuggestions}`);
    }
    lines.push(`Full plan: loop/iteration-${iteration}/plan/plan-summary.md`);
    lines.push("");
  }

  // Phase 3
  if (data.executeResults) {
    lines.push(`### Phase 3: Execute`);
    lines.push("");
    lines.push(
      `| Approach | Status | Primary Metrics | Baseline Delta |`
    );
    lines.push(
      `|----------|--------|-----------------|----------------|`
    );
    for (const r of data.executeResults) {
      const metricsStr = formatMetricsShort(r.metrics, r.target_eval);
      const deltaStr = formatDeltasShort(r.baseline_deltas);
      lines.push(
        `| ${r.approach.toUpperCase()} | ${r.status} | ${metricsStr} | ${deltaStr} |`
      );
    }
    lines.push("");
    for (const r of data.executeResults) {
      if (r.status === "error" && r.error) {
        lines.push(
          `Error details (${r.approach.toUpperCase()}): ${r.error.slice(0, 200)}`
        );
      }
    }
    lines.push(`Results archived: loop/iteration-${iteration}/execute/results/`);
    lines.push("");
  }

  // Phase 4
  if (data.votes) {
    lines.push(`### Phase 4: Analyze`);
    lines.push("");
    lines.push(
      `| Approach | Vote | Confidence | Auto-dropped | Key Concerns |`
    );
    lines.push(
      `|----------|------|------------|--------------|--------------|`
    );
    for (const v of data.votes) {
      const concerns = v.concerns.slice(0, 1).join("; ") || "—";
      lines.push(
        `| ${v.approach.toUpperCase()} | ${v.vote} | ${v.confidence} | ${v.auto_dropped ? "yes" : "no"} | ${concerns} |`
      );
    }
    lines.push(`Full votes: loop/iteration-${iteration}/analyze/`);
    lines.push("");
  }

  // Phase 5
  if (data.decision) {
    const d = data.decision;
    lines.push(`### Phase 5: Decision`);
    lines.push("");

    if (d.merged.length > 0) {
      lines.push(`**Merged**:`);
      for (const label of d.merged) {
        const commit = data.mergeCommits?.[label] ?? "unknown";
        lines.push(
          `- loop/iter-${iteration}/approach-${label} → commit ${commit}`
        );
      }
    }

    if (d.dropped.length > 0) {
      lines.push(`**Dropped**:`);
      for (const label of d.dropped) {
        const result = data.executeResults?.find((r) => r.approach === label);
        const reason = result?.error ?? result?.status ?? "decision";
        lines.push(
          `- loop/iter-${iteration}/approach-${label} (${reason})`
        );
      }
    }

    lines.push("");
    if (d.new_tw_baseline || d.new_sr_baseline) {
      lines.push(`**New baseline captured**:`);
      if (d.new_tw_baseline) {
        lines.push(
          `- tech-writer-eval: baselines/latest/ updated`
        );
      }
      if (d.new_sr_baseline) {
        lines.push(
          `- skill-routing-eval: results/latest.json updated`
        );
      }
    }

    lines.push("");
  }

  // Cumulative metrics
  if (
    data.twWeightedHistory ||
    data.twBordaHistory ||
    data.twFriedmanHistory ||
    data.srPassRateHistory
  ) {
    lines.push(`### Cumulative Metrics`);
    if (data.twWeightedHistory) {
      lines.push(
        `- techwriter weighted: [${data.twWeightedHistory.join(", ")}]`
      );
    }
    if (data.twBordaHistory) {
      lines.push(
        `- techwriter borda: [${data.twBordaHistory.join(", ")}]`
      );
    }
    if (data.twFriedmanHistory) {
      lines.push(
        `- Friedman p: [${data.twFriedmanHistory.join(", ")}]`
      );
    }
    if (data.srPassRateHistory) {
      lines.push(
        `- skill-routing pass rate: [${data.srPassRateHistory.join(", ")}]`
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
 * Append an entry to the journal file.
 */
export function appendToJournal(loopDir: string, entry: string): void {
  const journalPath = join(loopDir, "journal.md");
  appendFileSync(journalPath, "\n" + entry + "\n");
}

/**
 * Read the last N iteration blocks from the journal.
 * Returns an empty string if the journal doesn't exist.
 */
export function readLastJournalEntries(loopDir: string, count: number): string {
  const journalPath = join(loopDir, "journal.md");
  if (!existsSync(journalPath)) return "";

  const content = readFileSync(journalPath, "utf-8");
  // Split on "## Iteration " markers
  const blocks = content.split(/^(?=## Iteration \d+)/m).filter((b) =>
    b.trim().startsWith("## Iteration")
  );

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
// Formatting helpers
// ---------------------------------------------------------------------------

function formatMetricsShort(
  metrics: TechWriterMetrics | SkillRoutingMetrics | null,
  targetEval: string
): string {
  if (!metrics) return "—";

  if (
    targetEval === "tech-writer-eval" &&
    "weighted_scores" in metrics
  ) {
    const tw = metrics as TechWriterMetrics;
    const w = tw.weighted_scores?.techwriter?.toFixed(2) ?? "?";
    const b = tw.borda_counts?.techwriter ?? "?";
    const p = tw.friedman_p?.toFixed(3) ?? "?";
    return `weighted=${w}, borda=${b}, p=${p}`;
  }

  if (
    targetEval === "skill-routing-eval" &&
    "pass_rate" in metrics
  ) {
    const sr = metrics as SkillRoutingMetrics;
    return `pass_rate=${(sr.pass_rate * 100).toFixed(1)}% (${sr.passed}/${sr.total_tests})`;
  }

  return "—";
}

function formatDeltasShort(
  deltas: import("./types.ts").BaselineDeltas
): string {
  if (!deltas) return "—";

  const parts: string[] = [];

  if ("techwriter_weighted" in deltas && deltas.techwriter_weighted != null) {
    const v = deltas.techwriter_weighted;
    parts.push(`${v >= 0 ? "+" : ""}${v.toFixed(2)} weighted`);
  }
  if ("techwriter_borda" in deltas && deltas.techwriter_borda != null) {
    const v = deltas.techwriter_borda;
    parts.push(`${v >= 0 ? "+" : ""}${v} borda`);
  }
  if ("friedman_p_delta" in deltas && deltas.friedman_p_delta != null) {
    const v = deltas.friedman_p_delta;
    parts.push(`${v >= 0 ? "+" : ""}${v.toFixed(3)} p`);
  }
  if ("pass_rate_delta" in deltas && deltas.pass_rate_delta != null) {
    const v = deltas.pass_rate_delta;
    parts.push(`${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}pp pass rate`);
  }

  return parts.length > 0 ? parts.join(", ") : "—";
}
