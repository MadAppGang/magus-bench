#!/bin/bash
# run.sh - 4-Way Reference-Based Documentation Benchmark
#
# 3-phase pipeline:
#   Phase 1: Generate — produce docs with 4 approaches (default, techwriter, reference, gemini)
#   Phase 2: Judge   — 7 models blindly score all 4 samples (per-judge independent ordering)
#   Phase 3: Analyze — Borda count, weighted scores, two-table report
#
# This is NOT a standard autotest suite. It does not use runner-base.sh.
# Each individual execution reuses execute-test.sh from the shared framework.
#
# Usage:
#   ./research/tech-writer-eval/run.sh [OPTIONS]
#
# Options:
#   --output-dir <dir>     Custom output directory (default: results/run-TIMESTAMP)
#   --timeout <seconds>    Per-execution timeout (default: 600)
#   --skip-generate        Reuse existing generated docs (requires --output-dir)
#   --skip-judge           Reuse existing judge outputs (requires --output-dir)
#   --dry-run              Show what would run without executing
#   --help                 Show this help message

set -euo pipefail

# Prevent CLAUDECODE nesting issues
unset CLAUDECODE 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Look for execute-test.sh locally first, then fall back to autotest/framework
if [[ -f "$SCRIPT_DIR/execute-test.sh" ]]; then
  FRAMEWORK_DIR="$SCRIPT_DIR"
elif [[ -d "$SCRIPT_DIR/../../autotest/framework" ]]; then
  FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/../../autotest/framework" && pwd)"
else
  echo "ERROR: execute-test.sh not found. Place it alongside run.sh or set FRAMEWORK_DIR." >&2
  exit 1
fi
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd 2>/dev/null || echo "$SCRIPT_DIR")"

# Defaults
OUTPUT_DIR=""
TIMEOUT=600
SKIP_GENERATE=false
SKIP_JUDGE=false
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --skip-generate) SKIP_GENERATE=true; shift ;;
    --skip-judge) SKIP_JUDGE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help)
      head -25 "$0" | tail -24
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Dependency checks ---

if ! command -v jq &>/dev/null; then
  echo "ERROR: 'jq' not found. Install with: brew install jq" >&2
  exit 1
fi

if ! command -v bun &>/dev/null; then
  echo "ERROR: 'bun' not found. Install with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if ! command -v claudish &>/dev/null; then
  echo "ERROR: 'claudish' not found. Install with: npm install -g claudish" >&2
  exit 1
fi

# --- Portable timeout (macOS has no GNU timeout) ---
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs" && kill "$cmd_pid" 2>/dev/null ) &
  local watchdog_pid=$!
  wait "$cmd_pid" 2>/dev/null
  local rc=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  return $rc
}

# --- Load config ---

CONFIG_FILE="$SCRIPT_DIR/test-cases.json"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: test-cases.json not found in $SCRIPT_DIR" >&2
  exit 1
fi

# Load judge data (bash 3.2 compatible — no declare -A)
JUDGE_IDS=()
JUDGE_MODELS=()
JUDGE_METHODS=()
while IFS=$'\t' read -r id model method; do
  JUDGE_IDS+=("$id")
  JUDGE_MODELS+=("$model")
  JUDGE_METHODS+=("$method")
done < <(jq -r '.judges[] | [.id, .model, .method] | @tsv' "$CONFIG_FILE")

TOPIC=$(jq -r '.topic.title' "$CONFIG_FILE")
GEMINI_MODEL=$(jq -r '.generation.gemini_model' "$CONFIG_FILE")
MIN_OUTPUT_CHARS=$(jq -r '.thresholds.min_output_chars' "$CONFIG_FILE")
MIN_JUDGES=$(jq -r '.thresholds.min_judges' "$CONFIG_FILE")

# --- Output directory ---

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$SCRIPT_DIR/results/run-$TIMESTAMP"
fi

# --- Temp file cleanup trap ---
trap 'rm -f "$OUTPUT_DIR"/.slot_*.tmp 2>/dev/null || true' EXIT

# =====================================================================
# HELPER FUNCTIONS
# =====================================================================

# extract_output(transcript_path, output_file)
# Extracts final text from claudish JSONL transcript.
# Strategy 1: .type == "result" entry (claudish --json format)
# Strategy 2: concatenate all assistant text blocks (fallback)
extract_output() {
  local transcript="$1"
  local output_file="$2"

  if [[ ! -f "$transcript" ]]; then
    echo "ERROR: Transcript not found: $transcript" >&2
    return 1
  fi

  # Try to extract from "result" type entries first (claudish --json format)
  local result_text
  result_text=$(jq -rs '[.[] | select(.type == "result") | .result // empty] | last // empty' "$transcript" 2>/dev/null)

  if [[ -n "$result_text" && ${#result_text} -gt 50 ]]; then
    printf '%s' "$result_text" > "$output_file"
    return 0
  fi

  # Concatenate ALL assistant text blocks (not just last — captures multi-turn output)
  jq -rs '
    [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text // empty]
    | join("\n")
  ' "$transcript" 2>/dev/null > "$output_file"

  if [[ -s "$output_file" ]]; then
    return 0
  fi

  echo "ERROR: Could not extract text from transcript: $transcript" >&2
  return 1
}

# strip_coaching_prefix(input_file, output_file)
# Strips the dev plugin coaching block injected by SessionStart hook.
# Detects: line starting with `★ Coaching
# Strips: from that line through the closing `─{10,} line.
# Applied ONLY to gemini output (coaching hook fires on claudish sessions).
strip_coaching_prefix() {
  local input_file="$1"
  local output_file="$2"

  if grep -q '^`★ Coaching' "$input_file" 2>/dev/null; then
    awk '/^`★ Coaching/{found=1} found && /^`─{10,}/{found=0; next} !found{print}' \
      "$input_file" > "$output_file"
  else
    cp "$input_file" "$output_file"
  fi
}

# shuffle_4(a b c d)
# Returns a randomly shuffled space-separated string of 4 labels.
# macOS bash 3.2 compatible: uses $RANDOM, no declare -A.
shuffle_4() {
  local items=("$@")
  local n=${#items[@]}
  local i j tmp

  # Fisher-Yates shuffle
  for ((i = n - 1; i > 0; i--)); do
    j=$((RANDOM % (i + 1)))
    tmp="${items[$i]}"
    items[$i]="${items[$j]}"
    items[$j]="$tmp"
  done

  echo "${items[*]}"
}

# build_judge_prompt(judge_id, ordering, template_file, output_file)
# Assembles judge-specific prompt by inserting 4 sample contents in the judge's ordering.
# ordering is space-separated contestant labels: e.g. "C A D B"
# where A=default, B=techwriter, C=reference, D=gemini
build_judge_prompt() {
  local judge_id="$1"
  local ordering="$2"
  local template_file="$3"
  local output_file="$4"

  # Split ordering into array (bash 3.2 compatible)
  local slots
  slots=($ordering)
  # slots[0] = contestant label that goes into SAMPLE_A for this judge
  # slots[1] = contestant label that goes into SAMPLE_B for this judge
  # etc.

  # Map each slot index to the approach name (bash 3.2 compatible — use case)
  local i approach
  for i in 0 1 2 3; do
    local label="${slots[$i]}"
    case "$label" in
      A) approach="default" ;;
      B) approach="techwriter" ;;
      C) approach="reference" ;;
      D) approach="gemini" ;;
      *) echo "ERROR: Unknown contestant label: $label" >&2; return 1 ;;
    esac
    local src="$OUTPUT_DIR/generate/$approach/output.md"
    if [[ ! -f "$src" ]]; then
      echo "ERROR: Missing generate output: $src" >&2
      return 1
    fi
    cp "$src" "$OUTPUT_DIR/.slot_${i}.tmp"
  done

  # Assemble with awk (safe for special chars in markdown)
  awk '
    /\{\{SAMPLE_A\}\}/ { while ((getline l < "'"$OUTPUT_DIR/.slot_0.tmp"'") > 0) print l; next }
    /\{\{SAMPLE_B\}\}/ { while ((getline l < "'"$OUTPUT_DIR/.slot_1.tmp"'") > 0) print l; next }
    /\{\{SAMPLE_C\}\}/ { while ((getline l < "'"$OUTPUT_DIR/.slot_2.tmp"'") > 0) print l; next }
    /\{\{SAMPLE_D\}\}/ { while ((getline l < "'"$OUTPUT_DIR/.slot_3.tmp"'") > 0) print l; next }
    { print }
  ' "$template_file" > "$output_file"

  rm -f "$OUTPUT_DIR/.slot_"{0,1,2,3}.tmp
}

# =====================================================================
# SETUP
# =====================================================================

mkdir -p "$OUTPUT_DIR"
cp "$CONFIG_FILE" "$OUTPUT_DIR/test-cases.json"

# --- Print banner ---

echo "=== 4-Way Reference Documentation Benchmark ==="
echo "Topic:        $TOPIC"
echo "Approaches:   default | techwriter | reference | gemini"
echo "Judges:       ${JUDGE_IDS[*]}"
echo "Timeout:      ${TIMEOUT}s"
echo "Output:       $OUTPUT_DIR"
echo "Skip gen:     $SKIP_GENERATE"
echo "Skip judge:   $SKIP_JUDGE"
echo ""

if $DRY_RUN; then
  echo "[DRY RUN] Phase 1: Generate"
  echo "  default     → $OUTPUT_DIR/generate/default/output.md (internal claude)"
  echo "  techwriter  → $OUTPUT_DIR/generate/techwriter/output.md (internal claude)"
  echo "  reference   → $OUTPUT_DIR/generate/reference/output.md (copy from reference/)"
  echo "  gemini      → $OUTPUT_DIR/generate/gemini/output.md (claudish $GEMINI_MODEL)"
  echo ""
  echo "[DRY RUN] Phase 2: Judge (7 parallel, per-judge independent ordering)"
  for i in "${!JUDGE_IDS[@]}"; do
    echo "  ${JUDGE_IDS[$i]} (${JUDGE_MODELS[$i]}, ${JUDGE_METHODS[$i]}) → $OUTPUT_DIR/judge/${JUDGE_IDS[$i]}/"
  done
  echo "  sample-mapping.json → $OUTPUT_DIR/sample-mapping.json"
  echo ""
  echo "[DRY RUN] Phase 3: Analyze"
  echo "  bun $SCRIPT_DIR/analyze-results.ts $OUTPUT_DIR"
  echo ""
  echo "[DRY RUN] No executions performed."
  exit 0
fi

# =====================================================================
# PHASE 1: GENERATE
# =====================================================================

if ! $SKIP_GENERATE; then
  echo "=== Phase 1: Generate ==="
  echo ""

  # --- default ---
  echo "  Generating: default (internal)..."
  gen_dir="$OUTPUT_DIR/generate/default"
  mkdir -p "$gen_dir"
  prompt_file="$SCRIPT_DIR/prompts/generate-default.md"
  if [[ ! -f "$prompt_file" ]]; then
    echo "ERROR: Prompt file not found: $prompt_file" >&2; exit 1
  fi
  "$FRAMEWORK_DIR/execute-test.sh" \
    --test-id "generate-default" \
    --model "internal" \
    --prompt-file "$prompt_file" \
    --output-dir "$gen_dir" \
    --timeout "$TIMEOUT" \
    || { echo "ERROR: Generation failed for default" >&2; exit 1; }
  extract_output "$gen_dir/transcript.jsonl" "$gen_dir/output.md" \
    || { echo "ERROR: Failed to extract output for default" >&2; exit 1; }
  output_len=$(wc -c < "$gen_dir/output.md" | tr -d ' ')
  if [[ "$output_len" -lt "$MIN_OUTPUT_CHARS" ]]; then
    echo "ERROR: Generated output too short ($output_len chars) for default" >&2; exit 1
  fi
  echo "  OK: default ($output_len chars)"

  # --- techwriter ---
  echo "  Generating: techwriter (internal)..."
  gen_dir="$OUTPUT_DIR/generate/techwriter"
  mkdir -p "$gen_dir"
  prompt_file="$SCRIPT_DIR/prompts/generate-techwriter.md"
  if [[ ! -f "$prompt_file" ]]; then
    echo "ERROR: Prompt file not found: $prompt_file" >&2; exit 1
  fi
  "$FRAMEWORK_DIR/execute-test.sh" \
    --test-id "generate-techwriter" \
    --model "internal" \
    --prompt-file "$prompt_file" \
    --output-dir "$gen_dir" \
    --timeout "$TIMEOUT" \
    || { echo "ERROR: Generation failed for techwriter" >&2; exit 1; }
  extract_output "$gen_dir/transcript.jsonl" "$gen_dir/output.md" \
    || { echo "ERROR: Failed to extract output for techwriter" >&2; exit 1; }
  output_len=$(wc -c < "$gen_dir/output.md" | tr -d ' ')
  if [[ "$output_len" -lt "$MIN_OUTPUT_CHARS" ]]; then
    echo "ERROR: Generated output too short ($output_len chars) for techwriter" >&2; exit 1
  fi
  echo "  OK: techwriter ($output_len chars)"

  # --- reference ---
  echo "  Copying: reference (from reference/reference.md)..."
  gen_dir="$OUTPUT_DIR/generate/reference"
  mkdir -p "$gen_dir"
  ref_file="$SCRIPT_DIR/reference/reference.md"
  if [[ ! -f "$ref_file" ]]; then
    echo "ERROR: Reference file not found: $ref_file" >&2; exit 1
  fi
  cp "$ref_file" "$gen_dir/output.md"
  output_len=$(wc -c < "$gen_dir/output.md" | tr -d ' ')
  if [[ "$output_len" -lt "$MIN_OUTPUT_CHARS" ]]; then
    echo "ERROR: Reference output too short ($output_len chars) — fill in reference/reference.md" >&2; exit 1
  fi
  echo "  OK: reference ($output_len chars)"

  # --- gemini ---
  echo "  Generating: gemini ($GEMINI_MODEL via claudish)..."
  gen_dir="$OUTPUT_DIR/generate/gemini"
  mkdir -p "$gen_dir"
  prompt_file="$SCRIPT_DIR/prompts/generate-techwriter.md"
  if [[ ! -f "$prompt_file" ]]; then
    echo "ERROR: Prompt file not found: $prompt_file" >&2; exit 1
  fi

  # Gemini generation via claudish with stdin + background watchdog for timeout
  claudish \
    --model "$GEMINI_MODEL" \
    --stdin \
    --quiet \
    --json \
    < "$prompt_file" \
    > "$gen_dir/raw.jsonl" &
  gemini_pid=$!
  ( sleep "$TIMEOUT" && kill "$gemini_pid" 2>/dev/null ) &
  watchdog_pid=$!
  wait "$gemini_pid" 2>/dev/null
  exit_code=$?
  kill "$watchdog_pid" 2>/dev/null; wait "$watchdog_pid" 2>/dev/null
  if [[ $exit_code -ne 0 ]]; then
    if ! kill -0 "$gemini_pid" 2>/dev/null && [[ $exit_code -eq 137 || $exit_code -eq 143 ]]; then
      echo "ERROR: Gemini generation timed out after ${TIMEOUT}s" >&2
    else
      echo "ERROR: Gemini generation failed (exit=$exit_code)" >&2
    fi
    exit 1
  fi

  # Check raw output is non-empty before extracting
  if [[ ! -s "$gen_dir/raw.jsonl" ]]; then
    echo "ERROR: Gemini claudish produced empty output (raw.jsonl is empty)" >&2
    exit 1
  fi

  extract_output "$gen_dir/raw.jsonl" "$gen_dir/raw-output.md" \
    || { echo "ERROR: Failed to extract text from gemini transcript" >&2; exit 1; }

  # Check pre-strip length to diagnose coaching-strip false positives
  raw_output_len=$(wc -c < "$gen_dir/raw-output.md" | tr -d ' ')
  if [[ "$raw_output_len" -lt "$MIN_OUTPUT_CHARS" ]]; then
    echo "ERROR: Gemini raw output too short before coaching strip ($raw_output_len chars)" >&2
    exit 1
  fi

  strip_coaching_prefix "$gen_dir/raw-output.md" "$gen_dir/output.md"

  output_len=$(wc -c < "$gen_dir/output.md" | tr -d ' ')
  if [[ "$output_len" -lt "$MIN_OUTPUT_CHARS" ]]; then
    echo "ERROR: Gemini output too short after coaching strip ($output_len chars, was $raw_output_len before strip)" >&2
    exit 1
  fi
  echo "  OK: gemini ($output_len chars)"

  echo ""
  echo "  Generation complete."
  echo ""

else
  echo "=== Phase 1: Generate (SKIPPED) ==="
  # FIX: Validate all 4 approaches (not just default/techwriter)
  for approach in default techwriter reference gemini; do
    if [[ ! -f "$OUTPUT_DIR/generate/$approach/output.md" ]]; then
      echo "ERROR: Missing $OUTPUT_DIR/generate/$approach/output.md (needed for --skip-generate)" >&2
      exit 1
    fi
  done
  echo "  Using existing outputs in $OUTPUT_DIR/generate/"
  echo ""
fi

# =====================================================================
# PHASE 2: JUDGE
# =====================================================================

if ! $SKIP_JUDGE; then
  echo "=== Phase 2: Judge ==="
  echo ""

  # Generate per-judge independent random orderings
  # Contestants: A=default, B=techwriter, C=reference, D=gemini
  # ordering[i] = which contestant label occupies slot A/B/C/D for judge i
  # e.g. ordering "C A D B" means: slot A gets contestant C (reference),
  #      slot B gets contestant A (default), etc.

  JUDGE_ORDERINGS=()
  for i in "${!JUDGE_IDS[@]}"; do
    ordering=$(shuffle_4 A B C D)
    JUDGE_ORDERINGS+=("$ordering")
  done

  # Build sample-mapping.json
  # judge_orderings[judge_id] = array of 4 contestant labels, one per slot
  {
    printf '{\n'
    printf '  "contestants": {\n'
    printf '    "A": "default",\n'
    printf '    "B": "techwriter",\n'
    printf '    "C": "reference",\n'
    printf '    "D": "gemini"\n'
    printf '  },\n'
    printf '  "judge_orderings": {\n'
    local_sep=""
    for i in "${!JUDGE_IDS[@]}"; do
      judge_id="${JUDGE_IDS[$i]}"
      ordering="${JUDGE_ORDERINGS[$i]}"
      # Convert "C A D B" to ["C","A","D","B"]
      slots=($ordering)
      json_array="[\"${slots[0]}\",\"${slots[1]}\",\"${slots[2]}\",\"${slots[3]}\"]"
      printf '%s    "%s": %s' "$local_sep" "$judge_id" "$json_array"
      local_sep=$',\n'
    done
    printf '\n  },\n'
    printf '  "created_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '}\n'
  } > "$OUTPUT_DIR/sample-mapping.json"

  echo "  Sample mapping written: $OUTPUT_DIR/sample-mapping.json"

  TEMPLATE="$SCRIPT_DIR/prompts/judge-template-4way.md"
  if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: Judge template not found: $TEMPLATE" >&2; exit 1
  fi

  # Build per-judge prompts and launch judges in parallel
  JUDGE_PIDS=()
  for i in "${!JUDGE_IDS[@]}"; do
    judge_id="${JUDGE_IDS[$i]}"
    judge_model="${JUDGE_MODELS[$i]}"
    judge_method="${JUDGE_METHODS[$i]}"
    ordering="${JUDGE_ORDERINGS[$i]}"
    judge_dir="$OUTPUT_DIR/judge/$judge_id"
    judge_prompt="$OUTPUT_DIR/judge-prompt-${judge_id}.md"

    mkdir -p "$judge_dir"

    # Build this judge's prompt with their unique sample ordering
    build_judge_prompt "$judge_id" "$ordering" "$TEMPLATE" "$judge_prompt" || {
      echo "ERROR: Failed to build judge prompt for $judge_id" >&2; exit 1
    }

    echo "  Launching judge: $judge_id ($judge_model, ordering: $ordering)..."

    (
      if [[ "$judge_method" == "execute-test.sh" ]]; then
        "$FRAMEWORK_DIR/execute-test.sh" \
          --test-id "judge-$judge_id" \
          --model "$judge_model" \
          --prompt-file "$judge_prompt" \
          --output-dir "$judge_dir" \
          --timeout "$TIMEOUT" \
          || true
        extract_output "$judge_dir/transcript.jsonl" "$judge_dir/response.txt" 2>/dev/null || true
      else
        # claudish-based judge
        claudish \
          --model "$judge_model" \
          --stdin \
          --quiet \
          --json \
          < "$judge_prompt" \
          > "$judge_dir/transcript.jsonl" \
          2>/dev/null || true
        extract_output "$judge_dir/transcript.jsonl" "$judge_dir/response.txt" 2>/dev/null || true
      fi
    ) &
    JUDGE_PIDS+=($!)
  done

  echo ""
  echo "  Waiting for ${#JUDGE_PIDS[@]} judges to complete..."

  # Wait for all judges
  for pid in "${JUDGE_PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Count successful judges
  JUDGE_OK=0
  for judge_id in "${JUDGE_IDS[@]}"; do
    if [[ -f "$OUTPUT_DIR/judge/$judge_id/response.txt" && -s "$OUTPUT_DIR/judge/$judge_id/response.txt" ]]; then
      JUDGE_OK=$((JUDGE_OK + 1))
      echo "  OK: $judge_id"
    else
      echo "  FAIL: $judge_id (no response)"
    fi
  done

  echo ""
  echo "  Judges completed: $JUDGE_OK / ${#JUDGE_IDS[@]}"

  if [[ $JUDGE_OK -lt $MIN_JUDGES ]]; then
    echo "ERROR: Only $JUDGE_OK judges succeeded (minimum: $MIN_JUDGES)" >&2
    exit 1
  fi

  echo ""

else
  echo "=== Phase 2: Judge (SKIPPED) ==="
  if [[ ! -f "$OUTPUT_DIR/sample-mapping.json" ]]; then
    echo "ERROR: Missing $OUTPUT_DIR/sample-mapping.json (needed for --skip-judge)" >&2
    exit 1
  fi
  echo "  Using existing judge outputs in $OUTPUT_DIR/judge/"
  echo ""
fi

# =====================================================================
# PHASE 3: ANALYZE
# =====================================================================

echo "=== Phase 3: Analyze ==="
echo ""

bun "$SCRIPT_DIR/analyze-results.ts" "$OUTPUT_DIR" || {
  echo "WARNING: Analyzer returned non-zero exit code" >&2
}

echo ""
echo "=== Benchmark Complete ==="
echo "Output:        $OUTPUT_DIR"
echo "Mapping:       $OUTPUT_DIR/sample-mapping.json"
echo "Report (JSON): $OUTPUT_DIR/report/tech-writer-benchmark.json"
echo "Report (MD):   $OUTPUT_DIR/report/tech-writer-benchmark.md"
echo ""
