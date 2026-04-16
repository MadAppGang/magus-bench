#!/bin/bash
# run-experiment.sh - Run autotest with a specific CLAUDE.md experiment variant
#
# Usage:
#   ./experiments/run-experiment.sh <experiment-name> [additional run.sh args]
#
# Examples:
#   ./experiments/run-experiment.sh baseline
#   ./experiments/run-experiment.sh hypothesis-a --parallel 3
#   ./experiments/run-experiment.sh hypothesis-a-e --cases "delegate-debug-01-var-01"
#
# The script:
#   1. Backs up the current CLAUDE.md in the magus repo
#   2. Copies the experiment's CLAUDE.md into the repo
#   3. Runs the routing-synthetic autotest
#   4. Restores the original CLAUDE.md
#   5. Copies results back to the experiment folder

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPERIMENT_NAME="${1:?Usage: $0 <experiment-name> [run.sh args...]}"
shift

EXPERIMENT_DIR="$SCRIPT_DIR/$EXPERIMENT_NAME"
# Script moved from /experiments/ to /archive/claude-md-routing-2026-03/ — one extra level up.
REPO_DIR="$(cd "$SCRIPT_DIR/../../../claude-code" && pwd)"
ORIGINAL_CLAUDE_MD="$REPO_DIR/CLAUDE.md"

# Validate experiment exists
if [[ ! -f "$EXPERIMENT_DIR/CLAUDE.md" ]]; then
  echo "ERROR: Experiment '$EXPERIMENT_NAME' not found at $EXPERIMENT_DIR/CLAUDE.md" >&2
  echo "Available experiments:" >&2
  ls -d "$SCRIPT_DIR"/*/CLAUDE.md 2>/dev/null | while read f; do
    dirname "$f" | xargs basename
  done >&2
  exit 1
fi

# Default test cases (same 22 from baseline run for fair comparison)
DEFAULT_CASES="delegate-debug-01-var-01,delegate-debug-01-var-02,delegate-investigate-01-var-01,delegate-investigate-01-var-02,delegate-research-01-var-01,delegate-research-01-var-02,direct-simple-01-var-01,direct-simple-01-var-02,explicit-researcher-01-var-01,explicit-researcher-01-var-02,skill-claudemem-explicit-01-var-01,skill-claudemem-explicit-01-var-02,skill-claudemem-implicit-01-var-01,skill-claudemem-implicit-01-var-02,skill-not-agent-01-var-01,skill-not-agent-01-var-02,skill-routing-detective-01-var-01,skill-routing-detective-01-var-02,skill-simple-no-skill-01-var-01,skill-simple-no-skill-01-var-02,skill-spelling-bash-01-var-01,skill-spelling-bash-01-var-02"

# Check if --cases was provided in args
HAS_CASES=false
for arg in "$@"; do
  if [[ "$arg" == "--cases" ]]; then
    HAS_CASES=true
    break
  fi
done

echo "=== Experiment: $EXPERIMENT_NAME ==="
echo "Experiment CLAUDE.md: $EXPERIMENT_DIR/CLAUDE.md"
echo "Target repo: $REPO_DIR"
echo ""

# Show diff between baseline and experiment (routing section only)
echo "--- Changes from baseline ---"
diff --unified=0 "$SCRIPT_DIR/baseline/CLAUDE.md" "$EXPERIMENT_DIR/CLAUDE.md" 2>/dev/null | head -50 || echo "(no baseline diff or first run)"
echo "---"
echo ""

# Step 1: Backup original CLAUDE.md
BACKUP_FILE="$ORIGINAL_CLAUDE_MD.experiment-backup"
cp "$ORIGINAL_CLAUDE_MD" "$BACKUP_FILE"

# Ensure we always restore, even on error/interrupt
cleanup() {
  echo ""
  echo "--- Restoring original CLAUDE.md ---"
  if [[ -f "$BACKUP_FILE" ]]; then
    cp "$BACKUP_FILE" "$ORIGINAL_CLAUDE_MD"
    rm "$BACKUP_FILE"
    echo "Restored successfully."
  else
    echo "WARNING: Backup file not found at $BACKUP_FILE"
  fi
}
trap cleanup EXIT INT TERM

# Step 2: Copy experiment CLAUDE.md into repo
cp "$EXPERIMENT_DIR/CLAUDE.md" "$ORIGINAL_CLAUDE_MD"
echo "Swapped CLAUDE.md for experiment: $EXPERIMENT_NAME"
echo ""

# Step 3: Run the autotest
cd "$REPO_DIR"

CASES_ARG=""
if [[ "$HAS_CASES" == "false" ]]; then
  CASES_ARG="--cases $DEFAULT_CASES"
fi

echo "Running: ./autotest/routing-synthetic/run.sh --model internal $CASES_ARG $*"
echo ""

./autotest/routing-synthetic/run.sh --model internal $CASES_ARG "$@" 2>&1 | tee "$EXPERIMENT_DIR/last-run.log"

# Step 4: Find the latest results dir and copy summary to experiment
LATEST_RUN=$(ls -dt "$REPO_DIR/autotest/routing-synthetic/results"/run-* 2>/dev/null | head -1)
if [[ -n "$LATEST_RUN" && -f "$LATEST_RUN/results-summary.json" ]]; then
  cp "$LATEST_RUN/results-summary.json" "$EXPERIMENT_DIR/results-summary.json"
  cp "$LATEST_RUN/config.json" "$EXPERIMENT_DIR/run-config.json" 2>/dev/null || true

  # Quick summary
  echo ""
  echo "=== Quick Results: $EXPERIMENT_NAME ==="
  python3 -c "
import json,sys
d=json.load(open('$EXPERIMENT_DIR/results-summary.json'))
runs=d['runs']
total=len(runs)
pass_count=sum(1 for r in runs if r['result'] in ('PASS','PASS_DELEGATED'))
agent_runs=[r for r in runs if not r['test_id'].startswith(('explicit-skill','skill-'))]
skill_runs=[r for r in runs if r['test_id'].startswith(('explicit-skill','skill-'))]
ap=sum(1 for r in agent_runs if r['result'] in ('PASS','PASS_DELEGATED'))
sp=sum(1 for r in skill_runs if r['result'] in ('PASS','PASS_DELEGATED'))
print(f'Overall: {pass_count}/{total} ({pass_count/total*100:.0f}%)')
print(f'Agent delegation: {ap}/{len(agent_runs)} ({ap/len(agent_runs)*100:.0f}%)' if agent_runs else 'Agent delegation: N/A')
print(f'Skill routing: {sp}/{len(skill_runs)} ({sp/len(skill_runs)*100:.0f}%)' if skill_runs else 'Skill routing: N/A')
print()
print('Per-case results:')
for r in runs:
    status = r['result']
    emoji = '✅' if status in ('PASS','PASS_DELEGATED') else '❌'
    print(f\"  {emoji} {r['test_id']}: {status} (expected={r['expected_agent']}, actual={r['actual_agent']})\")
" 2>/dev/null || echo "Install python3 for quick summary"

  echo ""
  echo "Results dir: $LATEST_RUN"
  echo "Results copy: $EXPERIMENT_DIR/results-summary.json"
fi
