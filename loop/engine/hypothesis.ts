// loop/engine/hypothesis.ts
// Append-only hypothesis registry backed by loop/hypotheses.jsonl.
// Manages lifecycle transitions and knowledge feed-forward.

import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import type { Hypothesis, HypothesisStatus, HypothesisResult } from "./types.ts";

// Re-export types for convenience
export type { Hypothesis, HypothesisStatus, HypothesisResult };
export type {
  HypothesisIndependentVar,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Internal JSONL event types
// ---------------------------------------------------------------------------

interface CreatedEvent {
  event: "created";
  id: string;
  data: Omit<Hypothesis, "id">;
  ts: string;
}

interface TransitionEvent {
  event: "transition";
  id: string;
  from: HypothesisStatus;
  to: HypothesisStatus;
  result?: Partial<HypothesisResult>;
  ts: string;
}

type HypothesisEvent = CreatedEvent | TransitionEvent;

// ---------------------------------------------------------------------------
// Ledger entry (machine-readable outcome log)
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  iter: number;
  hId: string;
  verdict: string;
  dv: string[];
  iv: string;
  effect: Record<string, number | null>;
  ts: string;
}

// ---------------------------------------------------------------------------
// HypothesisRegistry
// ---------------------------------------------------------------------------

export class HypothesisRegistry {
  private readonly hypothesesPath: string;
  private readonly ledgerPath: string;

  constructor(private readonly loopDir: string) {
    this.hypothesesPath = join(loopDir, "hypotheses.jsonl");
    this.ledgerPath = join(loopDir, "experiment-ledger.jsonl");
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /**
   * Propose a new hypothesis. Assigns a monotonic ID (h-NNNN),
   * sets status to "proposed", and appends to hypotheses.jsonl.
   */
  propose(
    h: Omit<Hypothesis, "id" | "status" | "proposedAt">
  ): Hypothesis {
    const existing = this.getAll();
    const nextNum = existing.length + 1;
    const id = `h-${String(nextNum).padStart(4, "0")}`;
    const proposedAt = new Date().toISOString();

    const hypothesis: Hypothesis = {
      ...h,
      id,
      status: "proposed",
      proposedAt,
    };

    const event: CreatedEvent = {
      event: "created",
      id,
      data: {
        title: hypothesis.title,
        independentVar: hypothesis.independentVar,
        dependentVars: hypothesis.dependentVars,
        controlledFiles: hypothesis.controlledFiles,
        direction: hypothesis.direction,
        effectSizeFloor: hypothesis.effectSizeFloor,
        effectSizeExpected: hypothesis.effectSizeExpected,
        filesToChange: hypothesis.filesToChange,
        changeDescription: hypothesis.changeDescription,
        status: "proposed",
        proposedAt,
        proposedBy: hypothesis.proposedBy,
        iterationBorn: hypothesis.iterationBorn,
        iterationResolved: hypothesis.iterationResolved,
        result: hypothesis.result,
      },
      ts: proposedAt,
    };

    this.appendEvent(event);
    return hypothesis;
  }

  /**
   * Transition a hypothesis to a new status.
   * Optionally attach a result (for terminal states: accepted/rejected/etc.).
   * Appends a transition event to hypotheses.jsonl.
   */
  transition(
    id: string,
    status: HypothesisStatus,
    result?: Partial<HypothesisResult>
  ): void {
    const current = this.get(id);
    if (!current) {
      throw new Error(`Hypothesis "${id}" not found in registry`);
    }

    const event: TransitionEvent = {
      event: "transition",
      id,
      from: current.status,
      to: status,
      result,
      ts: new Date().toISOString(),
    };

    this.appendEvent(event);
  }

  /**
   * Append one line to the machine-readable experiment ledger.
   */
  appendLedger(entry: LedgerEntry): void {
    this.appendLine(this.ledgerPath, JSON.stringify(entry));
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /**
   * Replay the full JSONL log and return current state of all hypotheses.
   */
  getAll(): Hypothesis[] {
    const events = this.readEvents();
    return this.replayEvents(events);
  }

  /**
   * Get a single hypothesis by ID (current state after replay).
   */
  get(id: string): Hypothesis | null {
    return this.getAll().find((h) => h.id === id) ?? null;
  }

  /**
   * Get all hypotheses with a specific status.
   */
  getByStatus(status: HypothesisStatus): Hypothesis[] {
    return this.getAll().filter((h) => h.status === status);
  }

  /**
   * Get all accepted hypotheses.
   */
  getAccepted(): Hypothesis[] {
    return this.getByStatus("accepted");
  }

  /**
   * Get all rejected hypotheses.
   */
  getRejected(): Hypothesis[] {
    return this.getByStatus("rejected");
  }

  /**
   * Render the last N resolved hypotheses as a structured summary
   * for injection into research and planner prompts.
   */
  getKnowledgeSummary(n = 10): string {
    const resolvedStatuses: HypothesisStatus[] = [
      "accepted",
      "rejected",
      "inconclusive",
      "isolation_failed",
    ];

    const resolved = this.getAll()
      .filter((h) => resolvedStatuses.includes(h.status))
      .slice(-n);

    if (resolved.length === 0) {
      return "## Hypothesis History\n\nNo resolved hypotheses yet.";
    }

    const lines: string[] = ["## Hypothesis History (last " + resolved.length + ")"];
    lines.push("");
    lines.push("| ID | Title | DV | Direction | Effect | Verdict | Iteration |");
    lines.push("|----|-------|----|-----------|--------|---------|-----------|");

    for (const h of resolved) {
      const dv = h.dependentVars.join(", ");
      const effectStr = h.result
        ? Object.entries(h.result.observedMetrics)
            .map(([k, v]) => `${k}=${v ?? "?"}`)
            .join(", ")
        : "—";
      const verdict = h.status;
      const iteration = h.iterationResolved ?? h.iterationBorn;
      lines.push(
        `| ${h.id} | ${h.title} | ${dv} | ${h.direction} | ${effectStr} | ${verdict} | ${iteration} |`
      );
    }

    // Key findings section
    const accepted = resolved.filter((h) => h.status === "accepted");
    const rejected = resolved.filter((h) => h.status === "rejected");
    const inconclusive = resolved.filter((h) => h.status === "inconclusive");

    if (accepted.length > 0 || rejected.length > 0 || inconclusive.length > 0) {
      lines.push("");
      lines.push("## Key Findings");
      for (const h of accepted) {
        const effectStr = h.result
          ? h.result.explanation
          : "effect confirmed";
        lines.push(`- ${h.title} (${h.id}, accepted): ${effectStr}`);
      }
      for (const h of rejected) {
        lines.push(`- ${h.title} (${h.id}, rejected): no improvement detected`);
      }
      for (const h of inconclusive) {
        lines.push(`- ${h.title} (${h.id}, inconclusive): ambiguous result; may be worth retrying`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Human-readable summary of all accepted and rejected hypotheses.
   * Used for research agents that need to understand accumulated knowledge.
   */
  getKnowledgeSummaryFull(): string {
    return this.getKnowledgeSummary(1000);
  }

  /**
   * Apply prioritization rules to select up to `count` hypotheses
   * from the `proposed` pool for the current iteration.
   *
   * Rules (in order):
   * 1. File independence: no two selected hypotheses may share filesToChange
   * 2. Knowledge-graph ordering: hypotheses that build on accepted findings first
   * 3. Unresolved directions first: metrics with only inconclusive results
   * 4. Avoid redundancy with existing open hypotheses
   */
  selectForIteration(proposed: Hypothesis[], count: number): Hypothesis[] {
    if (proposed.length === 0) return [];

    const accepted = this.getAccepted();
    const inconclusive = this.getByStatus("inconclusive");

    // Score each hypothesis for prioritization
    const scored = proposed.map((h) => {
      let score = 0;

      // Reward building on accepted findings
      const buildsOnAccepted = accepted.some((a) =>
        h.changeDescription.includes(a.id) ||
        h.title.toLowerCase().includes(a.title.toLowerCase().split(" ").slice(0, 3).join(" "))
      );
      if (buildsOnAccepted) score += 10;

      // Reward targeting metrics that have only inconclusive results
      const targetsInconclusiveMetric = inconclusive.some((i) =>
        i.dependentVars.some((dv) => h.dependentVars.includes(dv))
      );
      if (targetsInconclusiveMetric) score += 5;

      // Prefer lower risk
      if (h.effectSizeExpected != null && Math.abs(h.effectSizeExpected) > 0) score += 2;

      return { h, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Select with file independence constraint
    const selected: Hypothesis[] = [];
    const usedFiles = new Set<string>();

    for (const { h } of scored) {
      if (selected.length >= count) break;

      // Check file independence
      const hasConflict = h.filesToChange.some((f) => usedFiles.has(f));
      if (hasConflict) continue;

      selected.push(h);
      for (const f of h.filesToChange) {
        usedFiles.add(f);
      }
    }

    return selected;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private appendEvent(event: HypothesisEvent): void {
    this.appendLine(this.hypothesesPath, JSON.stringify(event));
  }

  /**
   * Append a line atomically using a temp-file + rename pattern.
   * This prevents partial writes from corrupting the JSONL file.
   */
  private appendLine(filePath: string, line: string): void {
    // Ensure directory exists
    const dir = join(filePath, "..");
    mkdirSync(dir, { recursive: true });

    // Use appendFileSync for simplicity; at the expected scale (hundreds of
    // entries) this is safe and fast. A rename-based atomic append would be
    // needed only for high-concurrency scenarios.
    appendFileSync(filePath, line + "\n", "utf-8");
  }

  private readEvents(): HypothesisEvent[] {
    if (!existsSync(this.hypothesesPath)) return [];
    const content = readFileSync(this.hypothesesPath, "utf-8");
    const events: HypothesisEvent[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as HypothesisEvent);
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  }

  private replayEvents(events: HypothesisEvent[]): Hypothesis[] {
    const map = new Map<string, Hypothesis>();

    for (const event of events) {
      if (event.event === "created") {
        const h: Hypothesis = {
          id: event.id,
          ...event.data,
        };
        map.set(event.id, h);
      } else if (event.event === "transition") {
        const existing = map.get(event.id);
        if (!existing) continue;

        existing.status = event.to;

        // For terminal states, attach result if provided
        if (event.result) {
          if (
            event.to === "accepted" ||
            event.to === "rejected" ||
            event.to === "inconclusive" ||
            event.to === "isolation_failed"
          ) {
            existing.result = {
              verdict: event.to as HypothesisResult["verdict"],
              observedMetrics: event.result.observedMetrics ?? {},
              baselineMetrics: event.result.baselineMetrics ?? {},
              explanation: event.result.explanation ?? "",
              mergeCommit: event.result.mergeCommit ?? null,
              resolvedAt: event.result.resolvedAt ?? event.ts,
            };
          }
        }

        map.set(event.id, existing);
      }
    }

    return Array.from(map.values());
  }
}
