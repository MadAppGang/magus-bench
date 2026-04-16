#!/bin/bash
# run-autotest.sh — Run generated routing tests against real Claude Code CLI
#
# Bridge script: generates synthetic cases, imports into claude-code autotest,
# and runs the routing-synthetic suite.
#
# Usage:
#   ./benchmarks/skill-routing/run-autotest.sh [OPTIONS]
#
# Options:
#   --generate         Regenerate synthetic cases first (default: reuse existing)
#   --count <n>        Variations per seed for generation (default: 10)
#   --cases <ids>      Comma-separated case IDs to run (default: all)
#   --parallel <n>     Max parallel test executions (default: 1)
#   --dry-run          Show what would run
#   --help             Show this help
#
# Prerequisites:
#   - Claude Code CLI (claude) installed
#   - claudish installed (npm install -g claudish)
#   - Sibling repo: ../claude-code/autotest/routing-synthetic/ exists

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_CODE_DIR="$(cd "$REPO_ROOT/../claude-code" 2>/dev/null && pwd)" || {
  echo "ERROR: Sibling repo ../claude-code not found" >&2
  exit 1
}

AUTOTEST_DIR="$CLAUDE_CODE_DIR/autotest/routing-synthetic"
GENERATE=false
GEN_COUNT=10
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --generate) GENERATE=true; shift ;;
    --count) GEN_COUNT="$2"; shift 2 ;;
    --help) head -18 "$0" | tail -17; exit 0 ;;
    *) PASSTHROUGH_ARGS+=("$1"); shift ;;
  esac
done

# Step 1: Generate if requested or if no generated cases exist
if $GENERATE || [[ ! -f "$SCRIPT_DIR/generated/test-cases-generated.json" ]]; then
  echo "=== Step 1: Generate synthetic test cases ==="
  "$SCRIPT_DIR/generate-tests.sh" --count "$GEN_COUNT"
  echo ""
fi

# Step 2: Import into autotest
echo "=== Step 2: Import into autotest ==="
if [[ ! -d "$AUTOTEST_DIR" ]]; then
  echo "ERROR: $AUTOTEST_DIR not found" >&2
  echo "The routing-synthetic suite needs to be created in the claude-code repo." >&2
  exit 1
fi
"$AUTOTEST_DIR/import-cases.sh" --source "$SCRIPT_DIR/generated/test-cases-generated.json"
echo ""

# Step 3: Run autotest
echo "=== Step 3: Run autotest ==="
cd "$CLAUDE_CODE_DIR"
"$AUTOTEST_DIR/run.sh" "${PASSTHROUGH_ARGS[@]}"
