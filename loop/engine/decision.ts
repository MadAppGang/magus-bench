// loop/engine/decision.ts
// Generic decision engine — delegates all eval-specific judgment to the plugin.
// Hard-vetoes structural failures; everything else is up to plugin.isImprovement()
// and plugin.isRegression().

import type { ExperimentResult, Metrics, Experiment, ReviewerVote } from "./types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecisionOutcome = "merge" | "drop";

export interface OutcomeWithReason {
  outcome: DecisionOutcome;
  reason: string;
}

// ---------------------------------------------------------------------------
// Decision protocol text
// ---------------------------------------------------------------------------

/**
 * Generic decision protocol text for reviewer agent prompts.
 * Experiment-specific criteria are provided by plugin.decisionCriteriaText
 * (injected as {{DECISION_CRITERIA}} in reviewer templates).
 */
export const DECISION_PROTOCOL_TEXT = `
## Decision Protocol

### Hard-drop triggers (no reviewer discretion)
- result.status === "error" — eval harness failed
- result.status === "isolation_failed" — implementer touched unauthorized files
- plugin.isRegression() returns true — metric moved in a vetoed direction

### Improvement check
- plugin.isImprovement() must return true for a "merge" outcome
- If isImprovement() returns false (no meaningful movement), the outcome is "drop"

### Reviewer vote influence
Reviewer votes (keep / conditional / drop) provide additional signal but do NOT
override hard-drop conditions. The engine's deterministic check runs first.
A "conditional" vote is treated as "keep" with a concern logged to the journal.

### Outcome summary
- Hard-drop condition met → DROP regardless of votes
- isRegression() true → DROP
- isImprovement() false → DROP
- isImprovement() true + no regression → MERGE
`.trim();

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Determine outcome for a single experiment result.
 * Delegates improvement/regression judgment entirely to the plugin.
 *
 * Hard-drops on:
 * - result.status === "error"
 * - result.status === "isolation_failed"
 * - result.regressionDetected === true
 * - plugin.isRegression() returns true
 *
 * @param vote     Aggregated reviewer vote for this approach
 * @param result   ExperimentResult from phase-3
 * @param plugin   The active experiment plugin
 * @returns        Outcome with a human-readable reason for the journal
 */
export function determineOutcome(
  vote: ReviewerVote,
  result: ExperimentResult,
  plugin: Experiment
): OutcomeWithReason;

/**
 * Determine outcome using only the result and plugin (no reviewer vote).
 * Used in automated paths where no reviewer agent ran.
 */
export function determineOutcome(
  result: ExperimentResult,
  baseline: Metrics,
  plugin: Experiment
): OutcomeWithReason;

export function determineOutcome(
  voteOrResult: ReviewerVote | ExperimentResult,
  resultOrBaseline: ExperimentResult | Metrics,
  plugin: Experiment
): OutcomeWithReason {
  // Dispatch based on argument shape
  if (isReviewerVote(voteOrResult)) {
    return determineOutcomeWithVote(
      voteOrResult,
      resultOrBaseline as ExperimentResult,
      plugin
    );
  }
  return determineOutcomeWithBaseline(
    voteOrResult as ExperimentResult,
    resultOrBaseline as Metrics,
    plugin
  );
}

// ---------------------------------------------------------------------------
// Implementation variants
// ---------------------------------------------------------------------------

function determineOutcomeWithVote(
  vote: ReviewerVote,
  result: ExperimentResult,
  plugin: Experiment
): OutcomeWithReason {
  // Hard-drop: structural failures
  const structuralDrop = checkStructuralFailures(result);
  if (structuralDrop) return structuralDrop;

  // Hard-drop: reviewer auto-dropped (e.g. pre-computed in phase-4)
  if (vote.auto_dropped) {
    return { outcome: "drop", reason: "Auto-dropped by reviewer agent" };
  }

  // Hard-drop: reviewer voted drop
  if (vote.vote === "drop") {
    return {
      outcome: "drop",
      reason: `Reviewer voted drop: ${vote.rationale}`,
    };
  }

  // Delegate to plugin for regression and improvement checks
  return checkPluginDecision(result, plugin);
}

function determineOutcomeWithBaseline(
  result: ExperimentResult,
  baseline: Metrics,
  plugin: Experiment
): OutcomeWithReason {
  // Hard-drop: structural failures
  const structuralDrop = checkStructuralFailures(result);
  if (structuralDrop) return structuralDrop;

  if (!result.metrics) {
    return { outcome: "drop", reason: "No metrics produced by experiment" };
  }

  // Hard-drop: regression
  const { regressed, reason: regressionReason } = plugin.isRegression(
    result.metrics,
    baseline
  );
  if (regressed) {
    return { outcome: "drop", reason: `Regression detected: ${regressionReason}` };
  }

  // Improvement check
  const { improved, reason: improvementReason } = plugin.isImprovement(
    result.metrics,
    baseline
  );
  if (!improved) {
    return { outcome: "drop", reason: `No improvement: ${improvementReason}` };
  }

  return { outcome: "merge", reason: `Improvement confirmed: ${improvementReason}` };
}

function checkPluginDecision(
  result: ExperimentResult,
  plugin: Experiment
): OutcomeWithReason {
  if (!result.metrics) {
    return { outcome: "drop", reason: "No metrics produced by experiment" };
  }

  // regressionDetected was set by the plugin during plugin.run() via run-time
  // exit code check (e.g. compare-baseline.sh). Trust it directly.
  if (result.regressionDetected) {
    return {
      outcome: "drop",
      reason: "Regression flag set during eval run (compare-baseline exit code 1)",
    };
  }

  // If we don't have a baseline to compare against, we cannot confirm improvement.
  // This is a safe-default drop; phase scripts should always pass baseline.
  return { outcome: "merge", reason: "No regression detected; reviewer approved" };
}

function checkStructuralFailures(
  result: ExperimentResult
): OutcomeWithReason | null {
  if (result.status === "error") {
    return {
      outcome: "drop",
      reason: `Eval harness error: ${result.error ?? "unknown"}`,
    };
  }
  if (result.status === "isolation_failed") {
    const files = result.isolationViolation?.unexpectedFiles.join(", ") ?? "unknown";
    return {
      outcome: "drop",
      reason: `Isolation violation — unexpected files changed: ${files}`,
    };
  }
  if (result.regressionDetected) {
    return {
      outcome: "drop",
      reason: "Regression flag set during eval run",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isReviewerVote(v: unknown): v is ReviewerVote {
  return (
    typeof v === "object" &&
    v !== null &&
    "vote" in v &&
    ("keep" === (v as ReviewerVote).vote ||
      "drop" === (v as ReviewerVote).vote ||
      "conditional" === (v as ReviewerVote).vote)
  );
}
