#!/bin/bash
# capture-baseline.sh — Snapshot a completed benchmark run as a regression baseline.
#
# Usage:
#   ./capture-baseline.sh <results-dir>
#
# Example:
#   ./capture-baseline.sh results/run-20260306-085812
#
# The script reads the run's report JSON, extracts per-approach/per-criterion
# mean scores and the top-level weighted scores, then writes:
#   baselines/<run-name>/scores.json
#   baselines/<run-name>/metadata.json
# and updates baselines/latest/ to mirror that snapshot.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASELINES_DIR="$SCRIPT_DIR/baselines"

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <results-dir>" >&2
  echo "Example: $0 results/run-20260306-085812" >&2
  exit 1
fi

RESULTS_DIR="$1"

# Accept both absolute and relative paths (relative to script dir)
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

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Derive snapshot name from the results directory basename
# ---------------------------------------------------------------------------

RUN_NAME="$(basename "$RESULTS_DIR")"
SNAPSHOT_DIR="$BASELINES_DIR/$RUN_NAME"

if [[ -d "$SNAPSHOT_DIR" ]]; then
  echo "WARNING: Baseline snapshot already exists: $SNAPSHOT_DIR"
  echo "         Overwriting..."
fi

mkdir -p "$SNAPSHOT_DIR"

# ---------------------------------------------------------------------------
# Build scores.json
#
# Structure:
# {
#   "weighted_scores": { "default": 7.3, "techwriter": 7.9, ... },
#   "criteria": [
#     {
#       "criterion_id": "slop",
#       "criterion_name": "AI Slop Absence",
#       "weight": 2,
#       "mean_by_approach": { "default": 6.7, ... }
#     },
#     ...
#   ],
#   "absolute_ranking": ["techwriter", "default", ...],
#   "borda_counts": { "techwriter": 14, ... }
# }
# ---------------------------------------------------------------------------

jq '{
  weighted_scores: .weighted_scores,
  borda_counts:    .borda_counts,
  absolute_ranking: .absolute_ranking,
  criteria: [
    .criteria_results[] | {
      criterion_id:    .criterion_id,
      criterion_name:  .criterion_name,
      weight:          .weight,
      mean_by_approach: .mean_by_approach
    }
  ]
}' "$REPORT_JSON" > "$SNAPSHOT_DIR/scores.json"

# ---------------------------------------------------------------------------
# Build metadata.json
#
# Structure:
# {
#   "run_name":        "run-20260306-085812",
#   "run_dir":         "research/tech-writer-eval/results/run-20260306-085812",
#   "captured_at":     "2026-03-16T12:00:00Z",
#   "analyzed_at":     "2026-03-05T22:10:38.328Z",
#   "topic":           "...",
#   "successful_judges": 6,
#   "failed_judges":   ["qwen"],
#   "judge_models":    { "internal": "internal", "gemini": "gemini-3.1-pro-preview", ... },
#   "approaches":      ["default", "techwriter", "reference", "gemini"]
# }
# ---------------------------------------------------------------------------

CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq --arg run_name "$RUN_NAME" \
   --arg captured_at "$CAPTURED_AT" \
'{
  run_name:          $run_name,
  run_dir:           .run_dir,
  captured_at:       $captured_at,
  analyzed_at:       .analyzed_at,
  topic:             .topic,
  successful_judges: .successful_judges,
  failed_judges:     .failed_judges,
  judge_models: (
    [ .judge_details[] | { (.judge_id): .model } ] | add
  ),
  approaches: (.weighted_scores | keys | sort)
}' "$REPORT_JSON" > "$SNAPSHOT_DIR/metadata.json"

# ---------------------------------------------------------------------------
# Update baselines/latest/ to mirror this snapshot
# ---------------------------------------------------------------------------

cp "$SNAPSHOT_DIR/scores.json"   "$BASELINES_DIR/latest/scores.json"
cp "$SNAPSHOT_DIR/metadata.json" "$BASELINES_DIR/latest/metadata.json"

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

APPROACHES=$(jq -r '.weighted_scores | keys | join(", ")' "$SNAPSHOT_DIR/scores.json")
JUDGE_COUNT=$(jq -r '.successful_judges' "$SNAPSHOT_DIR/metadata.json")
ANALYZED_AT=$(jq -r '.analyzed_at' "$SNAPSHOT_DIR/metadata.json")

echo "=== Baseline Captured ==="
echo "Run:        $RUN_NAME"
echo "Analyzed:   $ANALYZED_AT"
echo "Judges:     $JUDGE_COUNT successful"
echo "Approaches: $APPROACHES"
echo "Snapshot:   $SNAPSHOT_DIR"
echo "Latest:     $BASELINES_DIR/latest/"
echo ""
echo "Weighted scores:"
jq -r '.weighted_scores | to_entries | sort_by(.value) | reverse[] | "  \(.key): \(.value)"' \
  "$SNAPSHOT_DIR/scores.json"
echo ""
echo "To compare a future run: ./compare-baseline.sh results/run-YYYYMMDD-HHMMSS"
