#!/usr/bin/env bash
# generate-tests.sh — wrapper for the synthetic test case generator
#
# Usage:
#   ./generate-tests.sh [options]
#
# Options:
#   --count <n>      Variations per seed case (default: 10)
#   --dry-run        Show what would be generated without API calls
#   --seed-skills    Path to skills seed JSON
#   --seed-agents    Path to agents seed JSON
#   --out-dir <dir>  Output directory (default: ./generated)
#   --help           Show generator help
#
# Examples:
#   ./generate-tests.sh --dry-run
#   ./generate-tests.sh --count 15
#   ./generate-tests.sh --out-dir /tmp/test-output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Require bun
if ! command -v bun &>/dev/null; then
  echo "Error: bun is not installed or not in PATH." >&2
  echo "Install from https://bun.sh/" >&2
  exit 1
fi

echo "Running: bun run ${SCRIPT_DIR}/generate-test-cases.ts $*"
echo ""

exec bun run "${SCRIPT_DIR}/generate-test-cases.ts" "$@"
