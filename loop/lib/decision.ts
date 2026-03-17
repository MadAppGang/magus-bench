import type { ReviewerVote, ApproachResult } from "./types.ts";

export type DecisionOutcome = "merge" | "drop";

/**
 * The decision protocol text for reviewer agent prompts.
 * Inlined from requirements section 6.
 */
export const DECISION_PROTOCOL_TEXT = `
## Decision Protocol

### tech-writer-eval — Keep Criteria
At least ONE primary criterion must be satisfied:
- Borda delta (techwriter): ≥ +1 Borda point
- Weighted score delta: ≥ +0.1 points (on 10-point scale)
- Friedman p improvement: p decreases by ≥ 0.05 (lower = stronger signal)
- Bootstrap CI improvement: CI narrows by ≥ 0.1 on either bound

Veto criteria (any one → mandatory DROP):
- regression_detected: true (compare-baseline.sh exited 1)
- Friedman p increases by > 0.10 (signal weakened)
- Any criterion mean drops below baseline − 0.8
- Successful judge count drops below 4

### skill-routing-eval — Keep Criteria
At least ONE primary criterion must be satisfied:
- Pass rate delta: ≥ +0.05 (5 percentage points)
- Category pass rate: ≥ +0.10 improvement on a previously failing category

Veto criteria (any one → mandatory DROP):
- Any previously passing test now fails
- Pass rate drops, even slightly

### Auto-drop triggers (no LLM review needed)
- result.status === "error"
- result.status === "degraded"
- result.regression_detected === true

### Vote aggregation (phase-5 decision)
- 3× keep → MERGE
- 2× keep + 1× conditional → MERGE (carry concern to next iteration)
- 2× keep + 1× drop → MERGE (log dissent)
- 1× keep + 2× drop → DROP
- 3× drop → DROP
- Any regression_detected → DROP regardless of votes
`.trim();

/**
 * Deterministic keep/drop logic for a single approach.
 * Implements requirements section 6.
 *
 * This is called per-approach in phase-5 after reviewer votes are collected.
 * The vote represents a single reviewer's assessment; phase-5 aggregates
 * votes from all reviewers and calls this per aggregated vote signal.
 */
export function determineOutcome(
  vote: ReviewerVote,
  result: ApproachResult
): DecisionOutcome {
  // Hard drops regardless of reviewer vote
  if (result.status === "error") return "drop";
  if (result.status === "degraded") return "drop";
  if (result.regression_detected) return "drop";
  if (vote.auto_dropped) return "drop";

  // Reviewer voted drop
  if (vote.vote === "drop") return "drop";

  // tech-writer-eval specific thresholds
  if (result.target_eval === "tech-writer-eval" && result.metrics != null) {
    const metrics = result.metrics as import("./types.ts").TechWriterMetrics;
    const deltas = result.baseline_deltas as import("./types.ts").TWBaselineDeltas | null;

    // Apply veto criteria deterministically
    if (deltas) {
      // Friedman p increases > 0.10 → veto
      if (deltas.friedman_p_delta != null && deltas.friedman_p_delta > 0.10) {
        return "drop";
      }
    }

    // If reviewer says keep or conditional, check primary criteria
    const meetsAnyPrimary = checkTWPrimaryCriteria(metrics, deltas);
    if (!meetsAnyPrimary) return "drop";
  }

  // skill-routing-eval specific thresholds
  if (result.target_eval === "skill-routing-eval" && result.metrics != null) {
    const metrics = result.metrics as import("./types.ts").SkillRoutingMetrics;
    const deltas = result.baseline_deltas as import("./types.ts").SRBaselineDeltas | null;

    const meetsAnyPrimary = checkSRPrimaryCriteria(metrics, deltas);
    if (!meetsAnyPrimary) return "drop";
  }

  // Vote is keep or conditional — allow merge
  return "merge";
}

function checkTWPrimaryCriteria(
  metrics: import("./types.ts").TechWriterMetrics,
  deltas: import("./types.ts").TWBaselineDeltas | null
): boolean {
  if (!deltas) return false;

  // Borda delta ≥ +1
  if (deltas.techwriter_borda != null && deltas.techwriter_borda >= 1) return true;

  // Weighted score delta ≥ +0.1
  if (deltas.techwriter_weighted != null && deltas.techwriter_weighted >= 0.1) return true;

  // Friedman p decreases by ≥ 0.05 (negative delta = improvement)
  if (deltas.friedman_p_delta != null && deltas.friedman_p_delta <= -0.05) return true;

  // Bootstrap CI improvement (check if explicitly flagged in deltas)
  if (
    typeof (deltas as Record<string, unknown>).bootstrap_ci_improvement === "number" &&
    ((deltas as Record<string, unknown>).bootstrap_ci_improvement as number) >= 0.1
  ) {
    return true;
  }

  return false;
}

function checkSRPrimaryCriteria(
  metrics: import("./types.ts").SkillRoutingMetrics,
  deltas: import("./types.ts").SRBaselineDeltas | null
): boolean {
  if (!deltas) return false;

  // Pass rate delta ≥ +0.05
  if (deltas.pass_rate_delta != null && deltas.pass_rate_delta >= 0.05) return true;

  // Category improvement check would need category-level data;
  // flagged via extended deltas if available
  if (
    typeof (deltas as Record<string, unknown>).category_improvement === "number" &&
    ((deltas as Record<string, unknown>).category_improvement as number) >= 0.1
  ) {
    return true;
  }

  return false;
}
