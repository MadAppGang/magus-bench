# Eval Harness Research Report: Testing Claude Code Skills & Plugins

**Session**: dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4
**Date**: 2026-03-14
**Status**: COMPLETE
**Exploration iterations**: 1 (all 4 planned sources read in a single pass)

---

## Executive Summary

The local repositories already contain a sophisticated, five-layer evaluation system spanning millisecond keyword-activation unit tests, multi-model agent delegation E2E tests, an LLM-as-judge 7-model panel (Borda count), and a domain-specific Python design-eval toolkit. This stack is more mature than most projects of equivalent size, but it has seven well-defined gaps: no regression baselines, no CI/CD scheduling, no adversarial testing, no cost dashboard, limited assertion types, no prompt A/B testing, and test case counts far below the 100+ minimum recommended by Anthropic.

The primary external recommendation is to adopt **promptfoo** as a declarative eval layer. Promptfoo is Anthropic's officially endorsed eval framework (5 of 9 course lessons), supports 60+ providers including a native `anthropic:claude-agent-sdk` provider that can load real skills and MCP servers, and provides a CI-ready CLI out of the box. Two integration paths exist: wrapping `claudish` as an `exec:` provider for low-risk adoption, or using the native Claude Agent SDK provider for highest-fidelity skill testing. **DeepEval**'s `ToolCorrectnessMetric` is the best complement for structured tool-call validation. **Inspect AI + inspect_swe** is architecturally compelling but experimental. The single most impactful near-term action is connecting the zero-cost Bun integration tests to CI.

---

## Research Questions & Answers

### Q1. What eval infrastructure already exists locally?

**Answer**: Five distinct eval layers exist across `magus-bench` and `claude-code`, ranging from zero-cost unit tests to expensive multi-model judge panels. The stack is functional and covers skill routing, agent delegation, doc quality, and design critique. Its primary operational gaps are the absence of regression baselines and CI/CD scheduling.

**Evidence**:
- Five layers identified: integration tests (Bun, no API cost, ms), autotest framework (bash+TS, 30-300s, medium cost), E2E skill activation tests (30-90s, high cost), tech-writer-eval (minutes, very high cost), design-eval Python toolkit [local-inventory]
- 10 autotest suites, 6 integration test files, 2 E2E YAML scenario files, 4 design-eval datasets (~1,570 examples) [local-inventory]
- 7 gaps identified: no regression testing, no prompt-level eval, no CI/CD, no cost dashboard, limited assertion types, no adversarial testing, no A/B prompt testing [local-inventory]
- Existing `comparator.ts` already calculates per-model pass rate, duration, tokens, and cost; the gap is that no baseline is stored to compare against [local-inventory]

**Confidence**: High (primary source review of local codebase)

---

### Q2. What does promptfoo offer for prompt/LLM evaluation?

**Answer**: Promptfoo is a mature, open-source, CLI-driven eval framework with declarative YAML test suites, 60+ model providers, a rich assertion library (30+ deterministic + 11 LLM-graded types), a native `anthropic:claude-agent-sdk` provider for real Claude Code sessions, automated red-teaming across 50+ vulnerability categories, and a multi-model matrix view. It can drive `claudish`-based workflows via an `exec:` custom provider. The main integration gaps are JSONL transcript parsing and multi-judge Borda aggregation, both of which can be handled by keeping the existing `analyze-results.ts` as a post-processor consuming promptfoo's JSON output.

**Key capability evidence**:
- `anthropic:claude-agent-sdk` provider accepts `working_dir`, `model`, `max_turns`, `permission_mode: acceptEdits`, `append_allowed_tools`, `mcp.servers`, and `setting_sources` [explorer-1-promptfoo, promptfoo.dev/docs/providers/claude-agent-sdk]
- `exec:` provider allows arbitrary subprocess: `exec: claudish --model google/gemini-2.5-flash --json --stdin` [explorer-1-promptfoo]
- Assertion types relevant to skill eval: `llm-rubric`, `g-eval`, `select-best`, `is-valid-openai-tools-call`, `javascript`, `python`, `cost`, `latency` [explorer-1-promptfoo]
- Red-team module auto-generates adversarial probes across agent-specific categories including unauthorized data access, privilege escalation, and SQL injection via tools [explorer-1-promptfoo]
- Notable risk: promptfoo announced joining OpenAI in early 2026; open-source status currently unchanged but bears monitoring [explorer-1-promptfoo]

**Confidence**: High

---

### Q3. What does Anthropic's prompt evaluation course teach?

**Answer**: Anthropic's 9-lesson `prompt_evaluations` course (GitHub: anthropics/courses) establishes a grading hierarchy (code-graded first, LLM-judge second, human last), requires 100+ test cases for statistical reliability, endorses LLM-as-judge with chain-of-thought + XML-structured output, and dedicates 5 of 9 lessons to promptfoo. Official guidance does not cover agentic or multi-turn eval — that remains an open gap in the ecosystem.

**Key methodology evidence**:
- Four-component eval anatomy: Example Input, Golden Answer, Model Output, Score [explorer-2-anthropic-evals, building_evals.ipynb]
- Canonical judge prompt pattern: `<thinking>` reasoning step before `<score>` or `<correctness>` tag; discard thinking, extract only the tag [explorer-2-anthropic-evals]
- "100+ test-case/golden-answer pairs for reliable results" — stated minimum [explorer-2-anthropic-evals, intro_to_evals notebook]
- Per-level anchor descriptions validated in Lesson 9 for 1-5 Likert scales (e.g., "Conciseness 1: unnecessarily long; 5: perfectly concise") [explorer-2-anthropic-evals]
- Synthetic test case generation via Claude itself: `generate_test_cases.ipynb` cookbook recipe [explorer-2-anthropic-evals]
- Anthropic agent SDK evaluation docs returned 404 at research time — no official agentic eval curriculum exists [explorer-2-anthropic-evals]

**Confidence**: High

---

### Q4. What other open-source eval frameworks could test Claude Code skills/plugins?

**Answer**: Eight frameworks were evaluated. Two have meaningful fit for agent/skill testing: **Inspect AI** (AISI, MIT, with `inspect_swe` wrapping `claude_code()` as a native agent in Docker) and **DeepEval** (confident-ai, Apache-2, with `ToolCorrectnessMetric` and MCP-specific metrics). Braintrust is the best TypeScript-native option if a hosted dashboard is acceptable. OpenAI Evals, lm-evaluation-harness, HELM, and AgentBench have very low fit for skill-routing tests.

**Confidence**: High

---

## Existing Infrastructure Inventory

### Layer 1 — Integration Tests: `claude-code/tests/integration/skills/`

**What it is**: Bun test runner using a skill-parser utility to verify that SKILL.md keyword triggers activate the correct skill for a given query.

**Maturity**: High. Fast (milliseconds), deterministic, no API calls, 6 test files covering skill activation, dev, multimodel, agentdev, and hooks.

**Gap**: Tests only activation triggers, not output quality. Passing does not mean the skill produces correct results.

---

### Layer 2 — Autotest Framework: `claude-code/autotest/framework/`

**What it is**: A shared bash+TypeScript engine (`runner-base.sh` → `execute-test.sh` → `aggregator.ts` → `comparator.ts`) that runs 10 E2E suites against real Claude Code or `claudish`. Captures JSONL transcripts, debug logs, and per-test `meta.json`.

**Maturity**: High. Supports multi-model matrix (`--models` flag), parallel execution, cost estimation, and a typed `EvalResult` enum (`PASS`, `PASS_ALT`, `PASS_DELEGATED`, `FAIL`, `FAIL_OVER_DELEGATED`, `NO_DELEGATION`, `TIMEOUT`, `ERROR`).

**Gap**: No regression baseline storage; no CI/CD scheduling; 8 test cases in the skills suite (well below 100+ target).

---

### Layer 3 — E2E Skill Activation Tests: `claude-code/tests/e2e/`

**What it is**: Five-phase pipeline (Load Scenarios → Execute Claude Code → Skill Detection → AI Quality Validation → Report Generation). YAML-driven scenarios with required/optional/forbidden skills, quality criteria with weights, and configurable score thresholds (`min_score: 7.0`, `min_consensus: 0.7`).

**Maturity**: Medium-High. CI/CD integration example exists (GitHub Actions). Both skill detection and quality validation are covered. High API cost limits frequency.

**Gap**: Non-deterministic due to live AI; skill detection relies on response parsing (markers, tool calls, path mentions) which can be brittle.

---

### Layer 4 — Tech-Writer-Eval: `magus-bench/tech-writer-eval/`

**What it is**: 4-way blind documentation quality comparison using a 7-model judge panel with Borda count + weighted criteria scoring. 9 evaluation criteria (AI Slop Absence, Writing Craft, Accuracy, Overall at weight 2.0; Readability, Structure at 1.5; Conciseness, Disclosure, Diagrams at 1.0).

**Maturity**: High for methodology; low for coverage. The Borda count + multi-judge panel is methodologically superior to single-judge approaches. `analyze-results.ts` (37K lines) provides comprehensive statistical analysis.

**Gap**: Only ~4 test cases. No CI/CD. No regression baselines. Judge prompts may benefit from explicit CoT steps.

---

### Layer 5 — Design-Eval: `claude-code/tools/design-eval/`

**What it is**: Python CLI toolkit for evaluating automated design critique models against 4 ground-truth datasets (~1,570 examples). Adapter pattern: implement `critique()` method returning `ModelOutput`.

**Maturity**: High within its domain. Unique in the stack for having large ground-truth datasets and structured precision/recall/F1 metrics.

**Gap**: Isolated from the bash+TS framework. Python-only; no bridge to the TypeScript evaluation pipeline.

---

### Summary of Gaps Across All Layers

| Gap | Impact | Addressable By |
|-----|--------|----------------|
| No regression baselines | High — cannot detect quality degradation | Store `results-summary.json` per run; version in git |
| No CI/CD for any layer | High — manual-only, misses regressions | GitHub Actions for Layer 1 (zero cost); Layer 3 on schedule |
| Test case count below 100+ | High — low statistical confidence | Synthetic generation via Claude |
| No adversarial testing | Medium — skill robustness unknown | Promptfoo red-team module |
| No prompt A/B comparison | Medium — prompt iteration is manual | Promptfoo multi-prompt matrix |
| No cost dashboard | Low — individual costs tracked, no trends | `comparator.ts` output → simple time-series |
| Limited assertion types | Medium — pass/fail or LLM-judge only | Add `contains`, `regex`, `is-json` checks for structured outputs |

---

## External Framework Landscape

### Promptfoo (Recommended Primary)

**Core architecture**: Declarative `promptfooconfig.yaml` defines a cross-product matrix of `prompts × providers × test cases`. The CLI (`promptfoo eval`) runs the full matrix, producing results as JSON/YAML/CSV/HTML or an interactive web UI. Multi-model comparison is first-class: listing multiple providers runs every test against every model simultaneously.

**Test case format**: YAML with `vars` (Nunjucks-templated inputs), `assert` (assertion list), `options` (per-test overrides), and `metadata`. Combinatorial vars, external file loading (CSV, JSONL, Google Sheets), and `storeOutputAs` for multi-turn context threading are all supported.

**Assertion types**: 30+ deterministic (string, regex, JSON schema, SQL, HTML, XML, cost, latency, tool-schema validation, NLP scores) and 11 model-assisted (embeddings, LLM rubric, G-Eval, factuality, ClosedQA, select-best, max-score).

**Agent testing**:
- `anthropic:claude-agent-sdk` provider runs real Claude Code sessions with filesystem access, tool allowlists, MCP server connections, and `setting_sources` for loading CLAUDE.md / skill definitions
- Multi-turn conversation via `_conversation` variable and `storeOutputAs`
- Tool-call validation via `is-valid-openai-tools-call` and custom JavaScript assertions

**Red-teaming**: Separate `promptfoo redteam` module auto-generates adversarial probes across 50+ vulnerability categories (prompt injection, privilege escalation, PII leakage, jailbreaks, agent-specific risks). Uses a separate attack model from the target.

**CI/CD**: CLI (`promptfoo eval`) is GitHub Actions-ready out of the box.

**Fit for this project**: High. Native Claude Agent SDK support, Anthropic-official endorsement, and the ability to wrap `claudish` as an `exec:` provider make it the natural declarative layer above the existing bash harness.

**Risk**: Promptfoo announced joining OpenAI in early 2026. Verify license trajectory before committing significant integration work.

---

### Anthropic Eval Patterns

**Course structure**: 9 lessons (anthropics/courses, `prompt_evaluations`). Lessons 1-4 cover eval theory, human grading, code-graded, and classification evals. Lessons 5-9 are entirely promptfoo-based (code-graded through custom model-graded).

**Grading hierarchy**:
1. Code-graded (exact match, keyword, regex, set-membership) — fastest, most scalable
2. LLM-graded (rubric-based, model-as-judge) — for subjective multi-criteria tasks
3. Human-graded (Workbench) — calibration only; not for production

**LLM-as-judge patterns**:
- Detailed, specific rubrics with per-level anchor text
- Structured binary or ordinal output only (`correct`/`incorrect` or `1-5`)
- Chain-of-thought inside `<thinking>` tags before the verdict tag; discard thinking
- Multiple rubrics for complex use cases (one rubric per quality dimension)
- 100+ test-case/golden-answer pairs as the stated minimum for statistical reliability

**Recommended practices for this project**:
- Add `<thinking>` CoT step to all 7-judge panel prompts
- Add per-level anchor descriptions to rubric scales
- Use `generate_test_cases.ipynb` pattern to synthesize 100+ skill invocation scenarios per skill category
- Use `get_assert()` Python hook in promptfoo to preserve Borda count aggregation logic while adopting declarative test management

**What Anthropic does not cover**: Agentic / multi-turn / tool-use eval. No official guidance exists for testing multi-step agents, tool-call chains, or filesystem side-effects. The agent SDK eval docs page returned 404 at research time.

---

### Other Frameworks

**DeepEval** (confident-ai/deepeval, Apache-2, 14k stars, actively maintained)
Richest set of agentic metrics in the Python ecosystem. `ToolCorrectnessMetric` scores tool-call correctness with configurable strictness (name only vs. name+args+output). `G-Eval` implements chain-of-thought LLM-as-judge for any custom rubric. MCP-specific metrics (MCP Task Completion, MCP Use, Multi-Turn MCP Use) are forward-looking for MCP-based skills. Integrates with pytest. No native subprocess support, but pre-captured JSONL transcripts can be fed as `LLMTestCase` objects.
**Fit**: High for structured tool-call validation; Medium for subprocess-driven agent orchestration.

**Inspect AI** (UKGovernmentBEIS/inspect_ai, MIT, 1,825 stars, AISI-maintained)
The most architecturally similar external framework to the local harness. Supports ReAct agents, multi-agent handoff (`handoff()` and `as_tool()` composition), Docker sandboxing, and custom Python scorers. The companion package `inspect_swe` exports a `claude_code()` agent factory that accepts `skills`, `mcp_servers`, and `attempts`, running real Claude Code in a Docker sandbox via `sandbox_agent_bridge`.
**Fit**: High conceptually; **risk: `inspect_swe` has only 14 stars and was created in early 2026 — experimental, not production-proven**.

**Braintrust** (braintrustdata, Apache-2 SDK / commercial platform)
TypeScript-first eval platform with `Eval()` function and `LLMClassifierFromTemplate` scorer. Most compatible with the existing TypeScript evaluator pipeline. Requires uploading data to `braintrust.dev` (hosted SaaS).
**Fit**: Medium — TypeScript-native integration is attractive; hosted data dependency is a drawback.

**RAGAS** (vibrantlabsai/ragas, Apache-2, 12.9k stars)
Originally RAG-focused; now includes agent metrics (Topic Adherence, Tool Call Accuracy, multi-turn conversation completeness). Message-list format is a useful reference for structuring JSONL transcripts in a standard-compatible way. Migrated from `explodinggradients` to `vibrantlabsai` org in late 2025; long-term maintenance uncertain.
**Fit**: Low-Medium — no native skill routing support; best used for pre-captured transcript evaluation.

**OpenAI Evals** (openai/evals, MIT, 18k stars)
Last meaningfully updated November 2025. Shifted to hosted platform. YAML+JSONL registry format is useful as a reference; the local Python framework is largely unmaintained. OpenAI-model-centric; no clean path for `claude -p` subprocess invocations.
**Fit**: Low — maintenance stalled; OpenAI-centric.

**AgentBench** (THUDM/AgentBench, MIT, ICLR 2024, 3.2k stars)
Fixed-environment Docker benchmark (OS shell, database, web shopping, etc.). Not extensible for custom skill routing tests. High infrastructure complexity (16GB RAM for webshop environment).
**Fit**: Very Low — fixed environments, not designed for custom skill/plugin testing.

**lm-evaluation-harness** (EleutherAI, MIT, 11.7k stars) and **HELM** (Stanford CRFM, Apache-2, 2.7k stars)
Academic benchmark gold standards. Prompt-in/completion-out only. No multi-turn, no subprocess, no tool-call evaluation. Power the HuggingFace Open LLM Leaderboard.
**Fit**: Very Low for skill routing; useful only for baseline model capability comparison.

---

## Framework Comparison Matrix

| Framework | Agent / Tool-Use | Multi-Model | LLM-Judge | Test Format | CI/CD | OSS License | Maintenance | Fit for Claude Code Skills |
|---|---|---|---|---|---|---|---|---|
| **Local autotest (bash+TS)** | Native (JSONL, subagent_type) | Yes (--models flag) | Yes (7-model Borda) | JSON test_cases | No (manual) | Private | Active | Native — built for this |
| **Local E2E tests** | Yes (skill detection + quality) | Yes | Yes (claudish judge) | YAML scenarios | Partial (CI example) | Private | Active | Native — built for this |
| **Local tech-writer-eval** | No (doc quality only) | Yes (4-way) | Yes (7-model Borda) | JSON test-cases.json | No | Private | Active | Partial (quality pattern only) |
| **promptfoo** | Strong (Claude Agent SDK, multi-turn, tool-call validation) | Yes (60+ providers) | Yes (llm-rubric, g-eval, select-best) | YAML (declarative, Nunjucks) | Yes (CLI + GitHub Actions) | MIT / Apache | Active (joining OpenAI 2026) | **High** — native Claude Agent SDK |
| **Inspect AI** | Strong (ReAct, multi-agent, Docker sandbox) | Yes (any model) | Yes (model_graded_qa, custom Python) | Python Task/Dataset | Yes (CI-friendly) | MIT | Active (AISI) | **High** — inspect_swe wraps claude_code() |
| **DeepEval** | Rich (ToolCorrectness, TaskCompletion, MCP metrics, G-Eval) | Configurable judge model | Yes (G-Eval, any model) | Python LLMTestCase | Yes (pytest) | Apache-2 | Active (14k stars) | **High** — ToolCorrectnessMetric maps to subagent_type |
| **Braintrust** | Limited (custom scorer only) | Yes | Yes (LLMClassifier) | TypeScript Eval() | Yes (hosted dashboard) | SDK: Apache-2; Platform: commercial | Active | Medium — TS-native; hosted dependency |
| **RAGAS** | Agent metrics (TopicAdherence, ToolCall, multi-turn) | Configurable judge | Yes (LLM judge) | Python message-list | No native CI | Apache-2 | Active (org migrated 2025) | Low-Medium — no native skill routing |
| **OpenAI Evals** | Minimal (model-graded YAML) | OpenAI models only | Yes (model-graded) | YAML + JSONL | Via CLI | MIT | Stalled (Nov 2025) | Low — OpenAI-centric, stalled |
| **LangSmith** | Trace-based only | Yes | Yes (custom evaluator) | Python @traceable | Hosted only | SDK: MIT; Platform: SaaS | Active | Low — privacy/hosted dependency |
| **AgentBench** | Fixed Docker environments | Yes | Task completion only | Fixed Docker | No | MIT | Active | Very Low — fixed environments |
| **lm-eval-harness** | None (prompt-response only) | Yes (API + HuggingFace) | Via custom metric | YAML task configs | Yes | MIT | Active (11k stars) | Very Low — academic benchmark |
| **HELM** | None (prompt-response only) | Yes | No | YAML scenarios | Yes | Apache-2 | Active | Very Low — academic benchmark |

---

## Recommended Architecture

The recommended architecture is a four-layer stack that preserves all existing infrastructure while adding two well-targeted external integrations.

### Layer 1: Fast Unit Tests — Keep and Connect to CI

**What**: The existing Bun integration tests at `claude-code/tests/integration/skills/`.

**Action**: Run on every commit in GitHub Actions. Zero API cost; millisecond execution. This alone closes the largest operational gap (no CI/CD) at zero marginal cost.

**Rationale**: Tests are already written; the only missing piece is the workflow file.

---

### Layer 2: Promptfoo for Prompt Eval and Multi-Model Comparison

**What**: Adopt promptfoo as the declarative test runner for the tech-writer-eval and for prompt-level skill quality evaluation.

**Integration path A (immediate, low risk)**: Wrap `claudish` as an `exec:` provider:
```yaml
providers:
  - 'exec: claudish --model google/gemini-2.5-flash --json --stdin'
  - 'exec: claudish --model openai/gpt-5 --json --stdin'
  - 'exec: claudish --model anthropic/claude-opus-4-6 --json --stdin'
```
Use `transform` field to extract final assistant message from JSONL. Port `test-cases.json` criteria to `llm-rubric` assertions. Keep `analyze-results.ts` consuming promptfoo's JSON output for Borda count / Friedman statistics.

**Integration path B (medium risk, highest fidelity)**: Use the native `anthropic:claude-agent-sdk` provider for skill/plugin testing:
```yaml
providers:
  - id: anthropic:claude-agent-sdk
    config:
      working_dir: /path/to/plugins/dev
      permission_mode: acceptEdits
      append_allowed_tools: [Bash, Write, Edit, Read]
      setting_sources:
        - /path/to/plugins/dev
```
Define test cases for each skill's expected tool calls and output patterns.

**What to defer**: Migrating Borda/Friedman analysis into promptfoo's assertion framework (adds promptfoo-specific complexity for marginal gain).

---

### Layer 3: Existing Autotest Framework for Agent-Specific E2E Tests

**What**: Keep the bash+TypeScript autotest framework as the primary runner for multi-turn agent delegation and skill routing tests that require JSONL transcripts and custom `EvalResult` semantics.

**Improvements to make**:
1. Add DeepEval `ToolCorrectnessMetric` as a cross-validation signal alongside the existing `subagent_type` string matching in `evaluator.ts`
2. Store `results-summary.json` per run and version it; use `comparator.ts` to flag >5% pass-rate drops as regression warnings
3. Expand skills suite from 8 to 100+ test cases using synthetic generation

---

### Layer 4: Infrastructure Improvements

1. **Judge prompt upgrades**: Add `<thinking>` CoT step before `<score>` in all 7-judge panel prompts. Add per-level anchor text to all rubric scales. Parse only `<score>` tags in aggregation.

2. **Synthetic test case generation**: Use the `generate_test_cases.ipynb` cookbook pattern with Claude to generate 50-100 realistic skill invocation scenarios per skill category (template the skill's SKILL.md description + 3-5 golden examples → ask Claude for variations).

3. **Red-team baseline**: Run `promptfoo redteam` against each plugin after adoption to establish an adversarial baseline. Focus on agent-specific categories: unauthorized data access, privilege escalation, and bash injection via tools.

4. **Inspect AI pilot (optional)**: Run a single simple skill-routing task through `inspect_swe`'s `claude_code()` wrapper to validate production maturity before committing to it as a sandboxed runner.

---

## Implementation Roadmap

Priority-ordered action items. Effort estimates: S = half-day, M = 1-2 days, L = 3-5 days.

| Priority | Action | Effort | Impact | Dependencies |
|----------|--------|--------|--------|--------------|
| 1 | Add GitHub Actions workflow for `tests/integration/skills/` (Bun, no API cost) | S | High — closes CI gap at zero cost | None |
| 2 | Upgrade all judge prompts to CoT + XML structured output (`<thinking>` + `<score>`) with per-level rubric anchors | S | High — improves judge reliability across all eval layers | None |
| 3 | Verify promptfoo's open-source license trajectory post-OpenAI acquisition | S | Critical gate — unblocks Recommendations 4-6 | None |
| 4 | Add promptfoo to tech-writer-eval (Path A: `exec:` provider wrapping `claudish`) | M | High — declarative test management, CI-ready matrix view | Rec 3 |
| 5 | Store `results-summary.json` baselines in git; add regression alert to autotest (>5% pass rate drop = warning) | S | High — enables detection of quality degradation | None |
| 6 | Generate 100+ synthetic skill invocation test cases per skill category using Claude (`generate_test_cases.ipynb` pattern) | M | High — closes gap between current 8 cases and 100+ minimum | None |
| 7 | Add DeepEval `ToolCorrectnessMetric` as cross-validation on autotest JSONL transcripts | M | Medium — structured tool-call validation; complements existing evaluator.ts | None |
| 8 | Adopt promptfoo Path B (native `anthropic:claude-agent-sdk` provider) for skill/plugin testing | L | High — highest-fidelity skill testing; reduces bespoke bash | Rec 3, Rec 4 |
| 9 | Run `promptfoo redteam` against one plugin to establish adversarial baseline | S | Medium — closes adversarial testing gap | Rec 4 |
| 10 | Run `inspect_swe` pilot with one simple skill-routing task to validate production maturity | M | Medium — determines viability of Inspect AI as sandboxed runner | None |

---

## Evidence Quality

### Factual Integrity

- Total factual claims sampled across all 4 findings files: ~100
- Claims with citations (source URL, file path, or labelled source): ~95
- Claims without citations (general framing): ~5
- **Factual Integrity: 95%** (target: 90%+) — **PASS**

### Agreement Score

- Total distinct findings across all sources: 13 primary findings
- Findings with multi-source (2+) support: 8
- Single-source findings: 5
- **Agreement Score: 62%** (target: 60%+) — **PASS**

### Source Quality Distribution

Total distinct sources cited: 43

| Quality | Count | Percentage |
|---------|-------|------------|
| High | 41 | 95% |
| Medium | 2 | 5% |
| Low | 0 | 0% |

**High quality source breakdown**:
- Official Anthropic course notebooks and docs: 11 sources
- Promptfoo official documentation pages: 9 sources
- GitHub repositories (primary source code + READMEs): 17 sources
- Official framework documentation pages: 4 sources

**Medium quality sources**:
- Anthropic Agent SDK eval docs (returned 404 — unresolvable): 1 source
- inspect_swe production maturity assessed from star count alone: 1 source

### Consensus Summary

| Level | Count | Key Examples |
|-------|-------|--------------|
| UNANIMOUS | 2 | Local stack has gaps (regression, CI/CD); Promptfoo is Anthropic's recommended tool |
| STRONG | 3 | CoT + XML judge pattern; No official agentic eval guidance; 100+ test case minimum |
| MODERATE | 3 | Inspect AI fit; claudish as exec: provider; DeepEval ToolCorrectnessMetric |
| SINGLE-SOURCE | 5 | Promptfoo/OpenAI risk; inspect_swe experimental status; RAGAS org migration; synthetic generation feasibility; design-eval ground-truth datasets |

---

## Methodology

**Research process**:
- Planning: 2026-03-14 (research-plan.md defines 4 sub-questions, 5 cross-cutting concerns)
- Exploration iterations: 1 (all 4 planned sources read in a single pass)
- Synthesis iterations: 1 (iteration-1.md)
- Final report: this document

**Models used**:
- Primary: claude-sonnet-4-6 (all 4 explorer agents)
- Strategy: native (local codebase review + direct HTTP fetch to known URLs)
- Web search: unavailable (MODEL_STRATEGY=native); substituted with direct HTTP fetch to official documentation URLs

**Sources consulted**:
- Local codebase files reviewed: ~15 (framework files, test files, config files)
- Official Anthropic docs and course notebooks: 11 sources
- Promptfoo official docs pages: 9 sources (fetched 2026-03-13)
- External framework GitHub repos and docs: 22 sources
- Total: 43+ unique sources

**Search strategy**:
- Local investigation: magus-bench and claude-code repositories reviewed directly
- HTTP fetch: known documentation URLs fetched directly (promptfoo.dev, GitHub raw, docs.anthropic.com)
- GitHub API: used for star counts, commit dates, and README discovery for external frameworks

**Convergence criterion**: Single iteration (all 4 sub-questions addressed in one pass); convergence check not applicable.

---

## Limitations

This research does NOT cover:

1. **Promptfoo post-OpenAI acquisition trajectory**: The acquisition was announced in early 2026. Whether the open-source license (currently MIT/Apache) will remain unchanged, change, or the product will be EOL'd is unknown. All promptfoo adoption recommendations should be gated on a license verification step.

2. **inspect_swe production maturity**: With only 14 GitHub stars and created in early 2026, `inspect_swe` is experimental. Its `claude_code()` wrapper has not been community-validated at any meaningful scale. Adopt only after a successful pilot.

3. **Official Anthropic agentic eval guidance**: No official Anthropic course or documentation covers evaluating multi-step agents, tool-use chains, or filesystem side-effects. Community resources (Inspect AI, DeepEval) fill this gap, but without Anthropic's validation.

4. **Plugin-dir to promptfoo mapping**: Whether the `--plugin-dir` CLI flag for locally-developed, unpublished plugins maps cleanly to promptfoo's `setting_sources` in the Claude Agent SDK provider was not empirically verified. Requires a test run.

5. **Pre-captured JSONL transcript ingestion into DeepEval**: No documented path was found for feeding existing `transcript.jsonl` files from the bash harness into DeepEval's `LLMTestCase` format without re-running tests.

6. **Borda count natively in promptfoo**: Friedman tests and Wilcoxon signed-rank tests are not natively supported by promptfoo; the existing `analyze-results.ts` statistical analysis must be preserved as a post-processor.

7. **RAGAS post-migration stability**: The `explodinggradients` → `vibrantlabsai` org migration is recent; long-term maintenance commitment is unproven.

8. **Cost and latency at scale**: This research characterized frameworks by feature support and architecture; it did not benchmark actual API cost or latency for running the recommended promptfoo or DeepEval integrations at the target scale (100+ test cases × multiple models).

---

## Appendix: Knowledge Gaps for Future Research

### Critical (should resolve before significant integration work)

- **Promptfoo license post-acquisition**: Query `"promptfoo OpenAI acquisition license MIT Apache 2026"`. Priority: CRITICAL before Phase 2 adoption.
- **Official agentic eval community consensus**: Query `"Claude Code agent evaluation SWE-bench skill routing 2025 2026"`. Priority: CRITICAL for correctness criteria design.
- **inspect_swe pilot**: Run one simple skill-routing task through `claude_code()` wrapper. Priority: CRITICAL before adopting Inspect AI path.

### Important

- **Plugin-dir to setting_sources mapping**: Empirically test whether `--plugin-dir /path/to/plugin` maps to `setting_sources: [/path/to/plugin]` in the Claude Agent SDK provider. Query: `"promptfoo claude-agent-sdk setting_sources plugin-dir local plugin"`.
- **DeepEval pre-captured transcript ingestion**: Query `"deepeval custom test case pre-captured JSONL transcript existing output"`.
- **Synthetic test case generation at skill scale**: Apply `generate_test_cases.ipynb` pattern to 2-3 skills as a proof of concept; verify quality of synthetic scenarios with a human spot-check.

### Nice-to-Have

- **Borda count in promptfoo**: Determine whether `select-best` / `max-score` assertions can approximate Borda count, or whether the existing `analyze-results.ts` must always be the aggregator.
- **RAGAS stability post-migration**: Monitor `vibrantlabsai/ragas` commit frequency over the next 3 months before adopting.
- **LangSmith self-hosted option**: If hosted data upload is a hard constraint, investigate whether LangSmith supports a self-hosted deployment.
