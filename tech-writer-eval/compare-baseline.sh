#!/bin/bash
# compare-baseline.sh — Compare a benchmark run against the stored baseline.
#
# Usage:
#   ./compare-baseline.sh <results-dir>
#
# Example:
#   ./compare-baseline.sh results/run-20260316-120000
#
# Reads baselines/latest/ for the golden snapshot and the new run's report.
# Prints a table of score deltas. Exits with code 1 if any (approach, criterion)
# pair has dropped more than 0.5 points (regression threshold).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASELINES_DIR="$SCRIPT_DIR/baselines"
REGRESSION_THRESHOLD="0.5"

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <results-dir>" >&2
  echo "Example: $0 results/run-20260316-120000" >&2
  exit 1
fi

RESULTS_DIR="$1"

if [[ "$RESULTS_DIR" != /* ]]; then
  RESULTS_DIR="$SCRIPT_DIR/$RESULTS_DIR"
fi

if [[ ! -d "$RESULTS_DIR" ]]; then
  echo "ERROR: Results directory not found: $RESULTS_DIR" >&2
  exit 1
fi

REPORT_JSON="$RESULTS_DIR/report/tech-writer-benchmark.json"
if [[ ! -f "$REPORT_JSON" ]]; then
  echo "ERROR: Report not found: $REPORT_JSON" >&2
  echo "       Run Phase 3 (analyze-results.ts) first." >&2
  exit 1
fi

BASELINE_SCORES="$BASELINES_DIR/latest/scores.json"
BASELINE_META="$BASELINES_DIR/latest/metadata.json"

if [[ ! -f "$BASELINE_SCORES" ]]; then
  echo "ERROR: No baseline found at $BASELINE_SCORES" >&2
  echo "       Capture one first: ./capture-baseline.sh results/<run-dir>" >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract metadata for header
# ---------------------------------------------------------------------------

BASELINE_DATE=$(jq -r '.analyzed_at | split("T")[0]' "$BASELINE_META")
BASELINE_JUDGES=$(jq -r '.successful_judges' "$BASELINE_META")
BASELINE_RUN=$(jq -r '.run_name' "$BASELINE_META")

CURRENT_DATE=$(jq -r '.analyzed_at | split("T")[0]' "$REPORT_JSON")
CURRENT_JUDGES=$(jq -r '.successful_judges' "$REPORT_JSON")
CURRENT_RUN="$(basename "$RESULTS_DIR")"

echo "=== Baseline Regression Check ==="
echo "Baseline: $BASELINE_DATE ($BASELINE_JUDGES judges) [$BASELINE_RUN]"
echo "Current:  $CURRENT_DATE ($CURRENT_JUDGES judges) [$CURRENT_RUN]"
echo ""

# ---------------------------------------------------------------------------
# Build the comparison table via a single jq invocation.
#
# We use --slurpfile to load the baseline scores alongside the current report.
# Output: TSV rows, one per (approach, criterion), sorted by approach then criterion.
#
# Columns: approach  criterion  baseline  current  delta  status
# ---------------------------------------------------------------------------

ALL_ROWS=$(jq -r \
  --slurpfile baseline "$BASELINE_SCORES" \
  --arg threshold "$REGRESSION_THRESHOLD" \
'
  # Shorthand references into the baseline snapshot
  ($baseline[0]) as $b |
  ($b.criteria | map({key: .criterion_id, value: .mean_by_approach}) | from_entries) as $base_criteria |
  ($b.weighted_scores) as $base_weighted |

  # --- Per-criterion rows ---
  (
    [
      .criteria_results[] |
      . as $crit |
      ($base_criteria[$crit.criterion_id] // {}) as $base_means |
      $crit.mean_by_approach | to_entries[] |
      . as $entry |
      select($base_means[$entry.key] != null) |
      {
        approach:  $entry.key,
        criterion: $crit.criterion_id,
        baseline:  ($base_means[$entry.key] | . * 10 | round / 10),
        current:   ($entry.value            | . * 10 | round / 10)
      }
    ]
  ) +

  # --- Weighted-total rows ---
  (
    [
      .weighted_scores | to_entries[] |
      . as $ws |
      select($base_weighted[$ws.key] != null) |
      {
        approach:  $ws.key,
        criterion: "weighted_total",
        baseline:  ($base_weighted[$ws.key] | . * 10 | round / 10),
        current:   ($ws.value              | . * 10 | round / 10)
      }
    ]
  ) |

  # Emit as TSV
  .[] |
  (.current - .baseline) as $delta |
  (if $delta < (-($threshold | tonumber)) then "REGRESSION" else "OK" end) as $status |
  [
    .approach,
    .criterion,
    (.baseline | tostring),
    (.current  | tostring),
    (if $delta >= 0 then ("+\($delta | . * 10 | round / 10)")
                    else  ("\($delta | . * 10 | round / 10)") end),
    $status
  ] | @tsv
' "$REPORT_JSON" | sort -u)

# ---------------------------------------------------------------------------
# Print formatted table
# ---------------------------------------------------------------------------

COL_APPROACH=12
COL_CRITERION=16
COL_NUM=9
COL_STATUS=12

printf "%-${COL_APPROACH}s %-${COL_CRITERION}s %${COL_NUM}s %${COL_NUM}s %${COL_NUM}s %s\n" \
  "Approach" "Criterion" "Baseline" "Current" "Delta" "Status"

printf '%0.s-' {1..70}
echo ""

REGRESSION_COUNT=0
OK_COUNT=0

while IFS=$'\t' read -r approach criterion baseline current delta status; do
  [[ -z "$approach" ]] && continue

  if [[ "$status" == "REGRESSION" ]]; then
    REGRESSION_COUNT=$((REGRESSION_COUNT + 1))
    status_display="*** REGRESSION"
  else
    OK_COUNT=$((OK_COUNT + 1))
    status_display="OK"
  fi

  printf "%-${COL_APPROACH}s %-${COL_CRITERION}s %${COL_NUM}s %${COL_NUM}s %${COL_NUM}s %s\n" \
    "$approach" "$criterion" "$baseline" "$current" "$delta" "$status_display"
done <<< "$ALL_ROWS"

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

if [[ $REGRESSION_COUNT -eq 0 ]]; then
  echo "RESULT: No regressions detected ($OK_COUNT checks passed)"
  echo ""
  exit 0
else
  echo "RESULT: $REGRESSION_COUNT regression(s) detected (threshold: -${REGRESSION_THRESHOLD} points)"
  echo ""
  echo "A regression means a score dropped by more than $REGRESSION_THRESHOLD points."
  echo "Given inter-judge variance (~0.9 sigma with ~6 judges), deltas under ~0.8"
  echo "points may be within measurement noise. Investigate drops >= 0.8 points."
  echo ""
  exit 1
fi
