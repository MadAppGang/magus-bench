# Skill Routing Eval

Promptfoo benchmark that measures how reliably Claude Code routes to the
correct tool when the Magus plugin ecosystem is active.

## What It Tests

Three failure modes were identified on 2026-02-16 (the "triple-failure
cascade") and are the primary targets of this benchmark:

| Failure | Description | Detection |
|---------|-------------|-----------|
| **Skill-as-agent** | Claude launches `code-analysis:claudemem-search` as a Task subagent instead of calling the Skill tool | `llm-rubric` |
| **Routing table miss** | Claude ignores the CLAUDE.md passive routing table and handles complex tasks inline | `llm-rubric` |
| **Spelling typo** | Bash commands spell `claudemem` as `clademem` after skill loading | `not-contains: clademem` |

The benchmark also tests the complementary good-path behaviours:

- Explicit skill requests use the Skill tool (not Task)
- Explicit agent requests delegate to the named agent
- Simple tasks are handled directly without unnecessary delegation
- Mixed prompts route each part to the correct tool

## Test Case Groups

| Group | Count | Source |
|-------|-------|--------|
| `explicit-skill` | 3 | `autotest/skills/test-cases.json` |
| `implicit-skill` | 1 | `autotest/skills/test-cases.json` |
| `agent-vs-skill` | 1 | `autotest/skills/test-cases.json` |
| `spelling` | 1 | `autotest/skills/test-cases.json` |
| `mixed-routing` | 1 | `autotest/skills/test-cases.json` |
| `no-skill` | 1 | `autotest/skills/test-cases.json` |
| `explicit-delegation` | 5 | `autotest/subagents/test-cases.json` |
| `passive-routing` | 2 | `autotest/subagents/test-cases.json` |
| `implicit-delegation` | 1 | `autotest/subagents/test-cases.json` |
| `hinted-delegation` | 4 | `autotest/subagents/test-cases.json` |
| `direct-handling` | 2 | `autotest/subagents/test-cases.json` |
| **Total** | **22** | |

## Prerequisites

```bash
# Node 18+ or Bun
npm install -g promptfoo   # or: bunx promptfoo

# Anthropic API key (for both the model under test and the llm-rubric judge)
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Running the Eval

```bash
cd skill-routing-eval

# Run all test cases against both providers
npx promptfoo eval -c promptfooconfig.yaml

# Run only one provider (faster iteration)
npx promptfoo eval -c promptfooconfig.yaml --providers "Claude Sonnet 4.6"

# Run a specific group of tests
npx promptfoo eval -c promptfooconfig.yaml --filter-metadata category=explicit-skill

# Open the interactive web UI
npx promptfoo view
```

Results are written to `results/latest.json`. The web UI reads from this file
and from promptfoo's local cache.

## Interpreting Results

Each test case has up to three assertion types:

| Type | What passes | Weight |
|------|-------------|--------|
| `contains` | Response text includes the expected substring | Hard (binary) |
| `not-contains` | Response text does NOT include the forbidden substring | Hard (binary) |
| `llm-rubric` | An LLM judge scores the response against a natural-language rubric | Soft (0–1) |

A passing run should show:

- All `contains` / `not-contains` checks green (these are deterministic)
- `llm-rubric` pass rate > 80 % for both providers on the `explicit-*` groups
- `llm-rubric` pass rate > 60 % for `passive-routing` and `implicit-delegation`
  groups (these are harder because no explicit instruction is given)

The most important metric is **`correct-skill-tool-usage`**: it catches the
core skill-as-agent failure. If this metric is red, check whether CLAUDE.md
still contains the skill routing table.

## File Layout

```
skill-routing-eval/
├── promptfooconfig.yaml   # Main promptfoo config (providers, prompts, test ref)
├── test-cases.yaml        # All 22 test cases in promptfoo format
├── results/
│   └── latest.json        # Written by `npx promptfoo eval` (git-ignored)
└── README.md              # This file
```

## Adding New Test Cases

1. Open `test-cases.yaml`.
2. Add a new YAML document block under the appropriate group comment.
3. Follow the existing structure:
   ```yaml
   - description: "One-sentence description of what is being tested"
     metadata:
       id: unique-kebab-case-id
       category: one-of-the-groups-above
       tags: [tag1, tag2]
       source: skills/test-cases.json   # or subagents/test-cases.json
     vars:
       prompt: >
         The prompt text sent to the model under test.
     assert:
       - type: contains
         value: "expected substring"
         metric: "short-metric-name"
       - type: llm-rubric
         value: >
           Natural language rubric. Be specific about what constitutes a
           PASS and what constitutes a FAILURE.
         provider: anthropic:messages:claude-sonnet-4-6
         metric: "short-metric-name"
   ```
4. Run `npx promptfoo eval --filter-metadata id=your-new-id` to test just
   the new case before running the full suite.

## Connection to Source Files

The test cases in `test-cases.yaml` are hand-converted from:

- `/Users/jack/mag/claude-code/autotest/skills/test-cases.json` — skill routing
- `/Users/jack/mag/claude-code/autotest/subagents/test-cases.json` — agent delegation

The original JSON files use a custom `checks` schema executed by the
`autotest/` harness. The YAML here re-expresses the same checks in promptfoo's
assertion vocabulary (`contains`, `not-contains`, `llm-rubric`), which makes
them runnable without any custom harness code.

## Synthetic Test Generation

Anthropic recommends 100+ test cases for statistical validity. The generator
uses Claude itself to expand the 22 seed cases above into 100+ synthetic
variations, following the Anthropic eval course recommendation for LLM-assisted
test case generation.

### Files

```
skill-routing-eval/
├── generate-tests.sh              # Bash entry point (wraps the TS script)
├── generate-test-cases.ts         # Bun/TypeScript generator
├── prompts/
│   └── generate-variations.md    # Prompt template sent to Claude per seed
└── generated/                     # Output directory (git-ignored)
    ├── test-cases-generated.json  # autotest JSON format
    └── test-cases-generated.yaml  # promptfoo YAML format
```

### How the Generator Works

1. Reads seed test cases from both autotest JSON files (22 seeds total)
2. For each seed, renders `prompts/generate-variations.md` with seed details
3. Calls Claude via `@anthropic-ai/sdk` (falls back to `claude -p` CLI if SDK absent)
4. Parses the returned JSON array of variant objects
5. Deduplicates using Jaccard token similarity (threshold: 0.80)
6. Writes both promptfoo YAML and autotest JSON to `generated/`

### Running

```bash
# Preview generation plan without API calls
./generate-tests.sh --dry-run

# Generate with defaults (10 variations per seed → ~220 before dedup)
./generate-tests.sh

# Generate more variations for better statistical coverage
./generate-tests.sh --count 15

# Custom output directory
./generate-tests.sh --out-dir /tmp/routing-tests
```

### Variant Types Generated per Seed

| Variant Type | Description |
|--------------|-------------|
| `rephrased` | Same intent, different words and sentence structure |
| `edge_case` | Boundary conditions, minimal or maximal phrasing |
| `adversarial` | Designed to plausibly trigger incorrect routing |
| `context_shift` | Same task framed in a different project or scenario |
| `terse` | Short, command-like prompt |
| `verbose` | Over-explained, highly contextual prompt |

### Difficulty Scale

| Level | Meaning |
|-------|---------|
| `easy` | No ambiguity — correct routing is obvious from the prompt |
| `medium` | Requires inference but routing is deterministic |
| `hard` | Genuinely ambiguous; tests routing logic under uncertainty |

### Output Formats

**autotest JSON** (`generated/test-cases-generated.json`) — compatible with
the `autotest/` harness in the `claude-code` repo:

```json
{
  "meta": { "generated_count": 208, "seed_count": 22 },
  "test_cases": [
    {
      "id": "explicit-researcher-01-var-03",
      "prompt": "...",
      "expected_outcome": "dev:researcher",
      "category": "explicit",
      "variant_type": "rephrased",
      "difficulty": "easy",
      "seed_id": "explicit-researcher-01"
    }
  ]
}
```

**promptfoo YAML** (`generated/test-cases-generated.yaml`) — ready for
`promptfoo eval` with auto-generated `contains` assertions derived from
`expected_outcome`:

```yaml
tests:
  - description: "explicit-researcher-01-var-03"
    vars:
      prompt: "..."
      expected_outcome: "dev:researcher"
    assert:
      - type: contains
        value: "dev:researcher"
```

### Prerequisites

The generator requires one of:

- `@anthropic-ai/sdk` installed with `ANTHROPIC_API_KEY` set:
  ```bash
  bun add @anthropic-ai/sdk
  export ANTHROPIC_API_KEY="sk-ant-..."
  ```
- `claude` CLI available in `PATH` (auto-detected fallback, no SDK needed)

### Deduplication

Near-duplicate prompts are dropped using Jaccard similarity on token sets
(tokens shorter than 3 characters are excluded as stopwords). Two prompts
are considered duplicates when their similarity exceeds 0.80. This keeps
the suite free of trivially redundant cases while preserving meaningfully
different phrasings of the same routing intent.

### Target Coverage

| Metric | Value |
|--------|-------|
| Seed cases | 22 |
| Default variations per seed | 10 |
| Raw generated (before dedup) | ~220 |
| Expected after dedup | 100–210 |
| Statistical validity threshold | 100+ |
