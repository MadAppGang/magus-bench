# Local Eval Infrastructure Inventory

**Session:** dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4
**Date:** 2026-03-14
**Scope:** All evaluation and testing infrastructure found in magus-bench and claude-code repositories

---

## 1. magus-bench/tech-writer-eval (Active Benchmark)

**Purpose:** 4-way blind documentation quality comparison

**Architecture:** Bash orchestrator (`run.sh`) → `execute-test.sh` → `claudish`/`claude -p` → `analyze-results.ts`

**Test case format:** JSON (`test-cases.json`) with meta, topic, approaches, evaluation criteria, judges

**Key features:**

- 4 approaches: `default` (vanilla), `techwriter` (anti-slop rules), `reference` (human-written), `gemini` (external model)
- 9 weighted evaluation criteria:
  | Criterion | Weight |
  |---|---|
  | AI Slop Absence | 2.0 |
  | Writing Craft | 2.0 |
  | Accuracy | 2.0 |
  | Overall | 2.0 |
  | Readability | 1.5 |
  | Structure | 1.5 |
  | Conciseness | 1.0 |
  | Disclosure | 1.0 |
  | Diagrams | 1.0 |
- 7-model judge panel: Claude (internal), MiniMax M2.5, Kimi K2.5, GLM-5, Gemini 3.1 Pro, GPT-5.3 Codex, Qwen 3.5+
- Per-judge independent randomization of approach labels for blindness
- Borda count + weighted scores + two-table reporting
- Results processed in TypeScript analyzer (`analyze-results.ts`, 37K lines)

**Location:** `/Users/jack/mag/magus-bench/tech-writer-eval/`

---

## 2. claude-code/autotest/framework (Shared E2E Test Engine)

**Purpose:** Shared test execution engine for all E2E suites

**Architecture:** `runner-base.sh` → `execute-test.sh` → `claudish` CLI → `aggregator.ts` → `comparator.ts`

**Components:**

| File | Role |
|---|---|
| `runner-base.sh` | Shared runner with `--suite`, `--model`, `--models`, `--parallel`, `--cases`, `--timeout`, `--dry-run` |
| `execute-test.sh` | Single test executor capturing JSONL transcript + debug log; supports native `claude -p` (internal) and `claudish` (external models) |
| `aggregator.ts` | Builds `results-summary.json` from all `meta.json` files |
| `comparator.ts` | Aggregate metrics across models — pass rate, avg duration, tokens, cost, turns |
| `evaluator.ts` | Pure pass/fail evaluation with `EvalResult` enum |
| `replay.ts` | Transcript replay for debugging |
| `types.ts` | 303-line comprehensive TypeScript type definitions for all JSON artifacts |

**EvalResult enum values:** `PASS`, `PASS_ALT`, `PASS_DELEGATED`, `FAIL`, `FAIL_OVER_DELEGATED`, `NO_DELEGATION`, `TIMEOUT`, `ERROR`

**Test case format:** JSON with `test_cases` array, each having `id`, `prompt`, `expected_agent`, `expected_alternatives`, `category`, `tags`

**Key features:**

- Multi-model matrix testing (e.g., `--models "monitor,google/gemini-2.5-flash,x-ai/grok-code-fast-1"`)
- Parallel execution with configurable concurrency
- Debug log parsing with token counting, tool call tracking, cost estimation
- Model comparison with per-test winners (speed, cost, tokens)

---

## 3. autotest Suites (10 Test Suites)

| Suite | Purpose | Notes |
|---|---|---|
| `subagents` | Agent delegation correctness | Tests `expected_agent` matches (explicit, implicit, passive-routing) |
| `team` | Multi-model `/team` command | Parallel model execution validation |
| `skills` | Skill routing (Skill vs Task disambiguation) | 8 test cases: explicit/implicit skill invocation, spelling, no-skill |
| `terminal` | Terminal plugin (`ht-mcp`, `tmux-mcp`) | 9 test cases for terminal interactions |
| `worktree` | Git worktree management | Worktree creation and cleanup |
| `coaching` | Coaching hook tests | Hook validation |
| `dev-loop` | Dev workflow testing | Development loop validation |
| `designer` | Designer plugin | 12 test cases for design validation |
| `code-roast` | Code quality roasting | Code review validation |
| `monitor` | Process monitoring | State machine, debug log parsing, CLI, sentinel tests |

---

## 4. claude-code/tests/integration/skills (Unit-level Skill Tests)

**Purpose:** Validate skill activation on keyword triggers without running Claude

**Architecture:** Bun test runner → skill-parser utility → keyword matching

**Test files:**

- `skill-activation.test.ts`
- `dev.test.ts`
- `multimodel.test.ts`
- `agentdev.test.ts`
- `hooks-validation.test.ts`
- `index.test.ts`

**Key pattern:** Parse `SKILL.md` frontmatter → extract keywords → test `wouldActivate(skill, query)` → assert `true`/`false`

**Strengths:** Fast (no API calls), deterministic, tests keyword coverage

**Limitations:** Only tests activation triggers, not output quality

---

## 5. claude-code/tests/e2e (E2E Skill Activation Tests)

**Purpose:** End-to-end validation of skill activation AND response quality

**Architecture:** 5 phases:
1. Load Scenarios
2. Execute Claude Code
3. Skill Detection
4. AI Quality Validation
5. Report Generation

**Test format:** YAML scenarios with expectations:
- Required/optional/forbidden skills
- Quality criteria with weights
- Model list
- Score thresholds

**YAML scenario files:** `dev-skills.yaml`, `multimodel-skills.yaml`

**Key features:**

- Skill detection via response parsing (explicit markers, tool calls, path mentions)
- Multi-model AI quality validation via `claudish`
- Score thresholds: `min_score` (default 7.0), `min_consensus` (default 0.7)
- JSON + Markdown report generation
- CI/CD integration example (GitHub Actions)

**Limitations:** Requires real Claude Code, incurs API costs, non-deterministic AI evaluations

---

## 6. claude-code/tools/design-eval (Python Evaluation Toolkit)

**Purpose:** Evaluate automated design critique models

**Architecture:** Python CLI (Click) → dataset loaders → model adapters → evaluators → metrics → reporting

**Datasets:**

| Dataset | Size |
|---|---|
| Design2Code | 484 |
| DesignBench edit | 359 |
| DesignBench repair | 28 |
| GraphicDesignEvaluation | 700 |
| **Total** | **~1,570** |

**Key features:**

- Adapter pattern: implement `critique()` method returning `ModelOutput` with issues + `dimension_scores`
- Built-in adapters: `dummy`, Anthropic (Claude), OpenAI
- Metrics: classification (precision/recall/F1), correlation, color, position, text, visual
- Reports: JSON and Markdown
- Dynamic model loading via `'module:ClassName'` format

**Framework:** `uv` + Python, completely independent from the bash/TS framework

---

## Summary: Existing Eval Layers

| Layer | Scope | Speed | API Cost | Quality Check |
|---|---|---|---|---|
| Integration tests (`skills/`) | Keyword activation | Fast (ms) | None | Activation only |
| Autotest framework (`autotest/`) | Agent delegation | Slow (30-300s) | Medium | Pass/fail + metrics |
| E2E tests (`tests/e2e/`) | Skill activation + quality | Slow (30-90s) | High | LLM-as-judge |
| Tech-writer-eval | Doc quality comparison | Very slow (min) | Very high | 7-model panel |
| Design-eval | Design critique | Medium | High | Ground-truth datasets |

---

## Gaps Identified

1. **No regression testing** — no baseline comparison to detect quality degradation over time
2. **No prompt-level evaluation** — existing tests focus on skill/agent routing, not prompt quality
3. **No automated scheduling** — all tests are manual (no CI/CD pipeline running)
4. **No cost tracking dashboard** — individual costs tracked per test but no trending
5. **Limited assertion types** — mostly pass/fail on agent selection, quality is LLM-judged only
6. **No adversarial testing** — no red-teaming or robustness testing for skills
7. **No A/B prompt testing** — can compare models but not prompt variants easily
