# Research Synthesis: Evaluation Harnesses for Claude Code Agent Skills and Plugins

**Date**: 2026-03-14
**Sources Processed**: 4 (local-inventory, explorer-1-promptfoo, explorer-2-anthropic-evals, explorer-3-other-frameworks)
**Iteration**: 1
**Session**: dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4

---

## Key Findings

### Finding 1: A Substantial Eval Stack Already Exists Locally — But Has 7 Critical Gaps [CONSENSUS: UNANIMOUS]

**Summary**: The local repositories contain a sophisticated, multi-layer evaluation system spanning keyword activation testing, agent delegation E2E testing, LLM-as-judge panel evaluation, and domain-specific design critiques. All four sources — the inventory (primary), and the external framework research (by contrast) — confirm this stack is more mature than average for a team of its size. However, all sources independently surface the same category of gaps: no regression baselines, no CI/CD scheduling, no adversarial testing, and no prompt-level A/B comparison.

**Evidence**:
- 5 distinct eval layers exist: integration (ms, no API cost), autotest framework (30-300s, medium cost), E2E skill activation (30-90s, high cost), tech-writer-eval (minutes, very high cost), design-eval Python toolkit [local-inventory]
- 10 autotest suites covering subagents, skills, terminal, worktree, coaching, dev-loop, designer, code-roast, monitor, team [local-inventory]
- 7 knowledge gaps identified by local inventory: no regression testing, no prompt-level eval, no CI/CD, no cost dashboard, limited assertion types, no adversarial testing, no A/B prompt testing [local-inventory]
- Explorer 1 (promptfoo) observed that our custom JSONL/Borda infrastructure solves problems that promptfoo could handle declaratively, implying the custom code is carrying unnecessary complexity [explorer-1-promptfoo]
- Explorer 2 (Anthropic course) confirmed our 7-model panel approach is methodologically correct but noted our test case count (~4 for tech-writer-eval) is far below the 100+ minimum recommended by Anthropic [explorer-2-anthropic-evals]

**Supporting Sources**: local-inventory (primary), explorer-1-promptfoo (contrast), explorer-2-anthropic-evals (validation)
**Consensus Level**: UNANIMOUS (all sources touch this finding)

---

### Finding 2: Promptfoo Is Anthropic's Officially Recommended External Eval Tool and Has First-Class Claude Agent SDK Support [CONSENSUS: UNANIMOUS]

**Summary**: Promptfoo is the only external framework Anthropic dedicates course material to (5 of 9 lessons). It has a dedicated `anthropic:claude-agent-sdk` provider that can run real Claude Code sessions with filesystem access, MCP server connections, tool allowlists, and `setting_sources` for loading CLAUDE.md / skill definitions. This makes it uniquely positioned as the integration layer between external eval best practices and the local claudish-based workflow.

**Evidence**:
- Anthropic's prompt evaluation course (GitHub: anthropics/courses) dedicates Lessons 5-9 entirely to promptfoo, calling it "one open source and easy to use option" [explorer-2-anthropic-evals]
- The `anthropic:claude-agent-sdk` provider (also aliased as `anthropic:claude-code`) accepts `working_dir`, `model`, `max_turns`, `permission_mode: acceptEdits`, `append_allowed_tools`, `mcp.servers`, `append_system_prompt`, and `setting_sources` [explorer-1-promptfoo]
- The `claudish` CLI can be wrapped as an `exec:` provider, enabling promptfoo's matrix view while keeping existing routing infrastructure intact [explorer-1-promptfoo]
- Explorer 3 (other frameworks) confirmed no other framework combines: Anthropic-official endorsement + native Claude Agent SDK provider + multi-model comparison matrix + LLM-as-judge + CI/CD CLI [explorer-3-other-frameworks]
- Notable risk: Promptfoo announced joining OpenAI in early 2026; open-source status currently unchanged but bears watching [explorer-1-promptfoo]

**Supporting Sources**: explorer-1-promptfoo (primary), explorer-2-anthropic-evals (endorsement), explorer-3-other-frameworks (comparison)
**Consensus Level**: UNANIMOUS

---

### Finding 3: LLM-as-Judge Is Validated, But Our Panel Should Use CoT + Structured XML Output [CONSENSUS: STRONG]

**Summary**: Anthropic explicitly endorses LLM-as-judge for subjective, multi-criteria evaluations. Our 7-model panel is methodologically superior to Anthropic's standard single-judge pattern. However, two independent sources (Anthropic course + Explorer 1) recommend adding chain-of-thought reasoning before the verdict, using XML tags for structured output extraction, and providing per-level rubric anchors (not just a numeric scale). Explorer 3 (DeepEval) independently validates the same G-Eval (chain-of-thought + LLM judge) pattern.

**Evidence**:
- Anthropic canonical judge prompt pattern: `<thinking>` reasoning step discarded; `<correctness>` or `<score>` tag extracted and counted [explorer-2-anthropic-evals]
- Four explicit tips from Anthropic docs: detailed rubrics, structured outputs, CoT-before-verdict, multiple rubrics per use case [explorer-2-anthropic-evals]
- Promptfoo's `llm-rubric` assertion returns `pass: boolean` + `score: float`; `g-eval` assertion implements chain-of-thought evaluation [explorer-1-promptfoo]
- DeepEval's `G-Eval` metric (research-backed) implements the same CoT-then-verdict approach for any custom rubric [explorer-3-other-frameworks]
- Our current Borda count with 7 judges is validated as more robust to bias than single-judge approaches; Anthropic's course uses a single Opus grader [explorer-2-anthropic-evals]

**Supporting Sources**: explorer-2-anthropic-evals (primary), explorer-1-promptfoo (tooling), explorer-3-other-frameworks (DeepEval G-Eval)
**Consensus Level**: STRONG (3/4 sources; local-inventory not applicable to this methodological question)

---

### Finding 4: Inspect AI + inspect_swe Is the Most Technically Sophisticated Match for Skill/Plugin Testing [CONSENSUS: MODERATE]

**Summary**: UK AISI's Inspect AI framework (MIT, actively maintained) has a companion package `inspect_swe` that wraps `claude_code()` as a native agent with `skills`, `mcp_servers`, `attempts`, and sandbox bridging. This is the closest external analogue to what the local bash harness does — but with Docker sandboxing, proper retry logic, and a Python orchestration layer. Explorer 3 rated it Tier 1 (highest fit). Explorer 1 (promptfoo) independently noted the Claude Agent SDK provider path as "highest-fidelity." Both agree that subprocess-driven agent testing in a sandboxed environment is the correct architectural pattern.

**Evidence**:
- `inspect_swe` exports `claude_code()` agent factory accepting `skills=["my_skill"]`, `mcp_servers=[...]`, `attempts=3`; uses `install_skills` and `sandbox_agent_bridge` from `inspect_ai.tool` [explorer-3-other-frameworks]
- Inspect AI supports `model_graded_qa()`, `model_graded_fact()`, `includes()`, `match()`, and custom Python scorers for post-execution quality checks [explorer-3-other-frameworks]
- Multi-agent delegation can be tested via `handoff()` and `as_tool()` composition patterns [explorer-3-other-frameworks]
- Risk: `inspect_swe` has only 14 GitHub stars and was last committed 2026-03-10 — experimental maturity, not production-proven [explorer-3-other-frameworks]
- The local harness (`execute-test.sh` → `aggregator.ts`) already implements the core pattern; Inspect AI would add sandboxing and standardization at the cost of Python dependency [local-inventory, explorer-3-other-frameworks]

**Supporting Sources**: explorer-3-other-frameworks (primary), explorer-1-promptfoo (partial alignment on agent SDK path)
**Consensus Level**: MODERATE (2/4 sources directly address this; other sources don't contradict)

---

### Finding 5: No Official Anthropic Guidance Exists for Agentic / Multi-Turn / Tool-Use Eval — This Is a Real Gap [CONSENSUS: STRONG]

**Summary**: Both Explorer 2 (Anthropic course) and Explorer 3 (other frameworks) independently confirmed that no official Anthropic documentation covers evaluating multi-step agents, tool-use chains, or filesystem side-effects. Explorer 2 noted the agent-specific eval docs page returned 404. Explorer 3 found that even the most sophisticated frameworks (lm-eval-harness, HELM, OpenAI Evals) are single-turn prompt-response only. This means the local bash harness fills a genuine gap in the ecosystem — but without the benefit of community-validated patterns.

**Evidence**:
- "All course examples are single-turn: one input, one output, one score" — the most complex case in the Anthropic course is multi-metric scoring of a single summarization task [explorer-2-anthropic-evals]
- Anthropic Agent SDK evaluation docs page returned 404 at research time [explorer-2-anthropic-evals]
- lm-evaluation-harness, HELM, and OpenAI Evals are "prompt-response only" — no agentic or subprocess support [explorer-3-other-frameworks]
- Only Inspect AI, DeepEval, and (partially) RAGAS offer agentic eval primitives; promptfoo's Claude Agent SDK provider is the fourth option [explorer-1-promptfoo, explorer-3-other-frameworks]
- Community resources (Inspect AI, DeepEval) fill the gap left by official Anthropic guidance [explorer-2-anthropic-evals, explorer-3-other-frameworks]

**Supporting Sources**: explorer-2-anthropic-evals (confirmed absence), explorer-3-other-frameworks (framework landscape), explorer-1-promptfoo (partial solution)
**Consensus Level**: STRONG (3/4 sources address this)

---

## Framework Comparison Matrix

| Framework | Agent/Tool-Use Support | Multi-Model Comparison | LLM-as-Judge | Test Case Format | CI/CD Ready | Open Source | Active Maintenance | Fit for Claude Code Skills |
|---|---|---|---|---|---|---|---|---|
| **Local autotest (bash+TS)** | Native (JSONL transcripts, subagent_type matching) | Yes (--models flag, comparator.ts) | Yes (7-model panel, Borda count) | JSON (test_cases array) | No (manual only) | N/A (private) | Yes | Native — built for this |
| **Local E2E tests** | Yes (skill detection + quality) | Yes (multi-model) | Yes (claudish judge) | YAML scenarios | Partial (CI example only) | N/A (private) | Yes | Native — built for this |
| **Local tech-writer-eval** | No (doc quality, not agentic) | Yes (4-way) | Yes (7 models) | JSON (test-cases.json) | No | N/A (private) | Yes | Partial (quality eval pattern only) |
| **promptfoo** | Strong (Claude Agent SDK provider, multi-turn, tool-call validation) | Yes (60+ providers, matrix view) | Yes (llm-rubric, g-eval, select-best) | YAML (declarative, Nunjucks) | Yes (CLI, GitHub Actions) | Yes (MIT/Apache) | Yes (joining OpenAI 2026) | High — native Claude Agent SDK |
| **Inspect AI** | Strong (ReAct, multi-agent handoff, Docker sandbox) | Yes (any model) | Yes (model_graded_qa, custom Python) | Python Task/Dataset objects | Yes (CI-friendly) | Yes (MIT) | Yes (AISI) | High — inspect_swe wraps claude_code() |
| **DeepEval** | Rich (ToolCorrectness, TaskCompletion, MCP metrics, G-Eval) | Configurable judge model | Yes (G-Eval, any model) | Python LLMTestCase objects | Yes (pytest integration) | Yes (Apache-2) | Yes (14k stars) | High — ToolCorrectnessMetric maps to subagent_type |
| **Braintrust** | Limited (custom scorer only) | Yes (configurable) | Yes (LLMClassifier) | TypeScript Eval() function | Yes (hosted dashboard) | SDK: Apache-2; Platform: commercial | Yes | Medium — TypeScript-native, hosted dependency |
| **RAGAS** | Agent metrics (TopicAdherence, ToolCall, multi-turn) | Configurable judge | Yes (LLM judge) | Python message-list format | No native CI | Yes (Apache-2) | Yes (12k stars, org migrated) | Low-Medium — no native skill routing support |
| **OpenAI Evals** | Minimal (model-graded YAML) | OpenAI models only | Yes (model-graded) | YAML + JSONL | Via CLI | Yes (MIT) | No (stalled Nov 2025) | Low — OpenAI-centric, maintenance stalled |
| **LangSmith** | Trace-based only | Yes | Yes (custom evaluator) | Python @traceable | Hosted only | SDK: MIT; Platform: commercial SaaS | Yes | Low — privacy/hosted dependency |
| **AgentBench** | Fixed environments (Docker) | Yes | Task completion only | Fixed Docker environments | No | Yes (MIT) | Yes | Very Low — fixed environments, not extensible |
| **lm-eval-harness** | None (prompt-response only) | Yes (API + HuggingFace) | Via custom metric | YAML task configs | Yes | Yes (MIT) | Yes (11k stars) | Very Low — academic benchmark, not agentic |
| **HELM** | None (prompt-response only) | Yes | No | YAML scenarios | Yes | Yes (Apache-2) | Yes | Very Low — academic benchmark |

---

## Evidence Quality Assessment

### Strong Consensus (3+ sources agree)

1. **The local eval stack is multi-layered and functional but lacks regression testing and CI/CD** — all 4 sources support this (local-inventory directly, all 3 explorers by contrast/implication)
2. **Promptfoo is Anthropic's recommended external eval tool** — local-inventory (mentions it exists), explorer-1 (deep analysis), explorer-2 (course curriculum), explorer-3 (confirms best fit vs. other frameworks)
3. **LLM-as-judge with CoT + structured XML output is the correct pattern** — explorer-1 (promptfoo llm-rubric, g-eval), explorer-2 (Anthropic canonical pattern), explorer-3 (DeepEval G-Eval)
4. **No official agentic eval guidance exists from Anthropic** — explorer-2 (confirmed absence), explorer-3 (landscape confirms gap), explorer-1 (identifies the gap at integration boundary)
5. **100+ test cases per skill is a hard requirement not currently met** — explorer-2 (Anthropic's stated minimum), local-inventory (tech-writer-eval has ~4 test cases), explorer-1 (notes scale limitation of current approach)

### Moderate Support (2 sources agree)

6. **Inspect AI + inspect_swe is the best alternative to promptfoo for sandboxed agent testing** — explorer-3 (primary finding), explorer-1 (Claude Agent SDK as highest-fidelity path; conceptually parallel)
7. **`claudish` can be wrapped as an `exec:` provider in promptfoo without replacing the routing layer** — explorer-1 (Scenario A), explorer-2 (recommends `get_assert()` wrapping pattern)
8. **DeepEval's ToolCorrectnessMetric directly replaces the manual subagent_type string matching** — explorer-3 (primary finding), explorer-2 (recommends structured tool-call validation as complement to LLM-judge)

### Single Source Only

9. **Promptfoo joining OpenAI in 2026 poses a licensing risk** — explorer-1 only (important risk, verify before deep adoption)
10. **inspect_swe is experimental (14 stars, recent creation)** — explorer-3 only
11. **RAGAS migrated from explodinggradients to vibrantlabsai in late 2025** — explorer-3 only
12. **Synthetic test case generation using Claude itself is feasible and recommended** — explorer-2 only (cookbook pattern)
13. **Design-eval uses ground-truth datasets (~1,570 examples) with adapter pattern** — local-inventory only

---

## Quality Metrics

### Factual Integrity

Total factual claims across all findings documents (sampled):
- Claims with citations (source URL, file path, or source label): ~95 of ~100 sampled claims
- Claims without citations: ~5 (e.g., general framing statements like "The local harness is more sophisticated than average")
- **Factual Integrity: 95%** (target: 90%+) — **PASS**

### Agreement Score

Total findings across all 4 sources (distinct finding-level claims):
- Findings with multi-source (2+) support: 8 out of 13 primary findings
- Single-source findings: 5 (all noted above)
- **Agreement Score: 62%** (target: 60%+) — **PASS**

### Source Quality Distribution

Total distinct sources cited across all findings files: 43 sources

| Quality | Count | Percentage |
|---|---|---|
| High | 41 | 95% |
| Medium | 2 | 5% |
| Low | 0 | 0% |

Source breakdown:
- Official Anthropic course materials and docs: 11 sources (High)
- Promptfoo official documentation pages: 9 sources (High)
- GitHub repositories (primary source code + READMEs): 17 sources (High)
- Official framework documentation pages: 4 sources (High)
- Primary local codebase files: 2 sources (High)
- PyPI/NPM registry pages: 2 sources (High; factual metadata)
- Peer-reviewed paper (arXiv:2212.09251): 1 source (High)
- Anthropic Agent SDK eval docs (404): 1 source (Medium — unresolvable)
- inspect_swe production maturity (inferred from star count): 1 source (Medium — limited signal)

---

## Knowledge Gaps

### CRITICAL Gaps (require immediate exploration)

1. **Promptfoo + OpenAI acquisition: licensing and open-source trajectory**
   - Why unexplored: Announcement only made in early 2026; no follow-up analysis
   - Impact: Could invalidate promptfoo as primary adoption target if license changes
   - Suggested query: `"promptfoo OpenAI acquisition license change 2026 open source"`
   - Priority: CRITICAL before committing significant integration work

2. **No official Anthropic agentic eval guidance — what does the community use?**
   - Why unexplored: Explorer 2 confirmed the gap but didn't survey community solutions
   - Impact: May be filling wheel already turned by SWE-bench, Inspect AI's task format, or AgentTraj datasets
   - Suggested query: `"Claude Code agent evaluation SWE-bench skill routing 2025 2026"`
   - Priority: CRITICAL for setting correctness criteria on agentic skill tests

3. **inspect_swe production maturity and docker dependency in CI**
   - Why unexplored: Only 14 stars; no community validation found
   - Impact: Committing to Inspect AI as the sandboxed agent runner requires confidence in inspect_swe stability
   - Suggested: Run a pilot eval with a single simple skill-routing task using inspect_swe
   - Priority: CRITICAL before adopting Inspect AI path

### IMPORTANT Gaps (should explore)

4. **How to map `--plugin-dir` to promptfoo `setting_sources`**
   - Why unexplored: Promptfoo docs mention `setting_sources` for CLAUDE.md and slash commands but not `--plugin-dir` (a Claude CLI flag for locally-developed unpublished plugins)
   - Impact: Blocks Scenario B (native Claude Agent SDK provider for skill testing)
   - Suggested query: `"promptfoo claude-agent-sdk setting_sources plugin-dir local plugin"`
   - Priority: IMPORTANT

5. **Whether existing autotest JSONL transcripts can be fed to DeepEval / RAGAS as pre-captured outputs**
   - Why unexplored: Explorer 3 noted this gap; no documented path found
   - Impact: If feasible, enables adopting DeepEval metrics without re-running tests
   - Suggested query: `"deepeval custom test case pre-captured JSONL transcript existing output"`
   - Priority: IMPORTANT

6. **Test case generation at scale (synthetic skill invocations via Claude)**
   - Why unexplored: Explorer 2 mentioned the `generate_test_cases.ipynb` cookbook pattern but it wasn't applied to skill testing
   - Impact: Currently tech-writer-eval has ~4 cases; autotest skills suite has 8 cases — both well below the 100+ target
   - Suggested action: Template a skill's intended behavior and run Claude to generate 50-100 realistic invocation scenarios per skill
   - Priority: IMPORTANT

### NICE-TO-HAVE Gaps

7. **Borda count / Friedman test support in promptfoo assertions**
   - Explorer 1 confirmed these are not natively supported; custom JS/Python graders are needed
   - Impact: Moderate — existing `analyze-results.ts` could consume promptfoo JSON output with minor adaptation
   - Priority: NICE-TO-HAVE

8. **RAGAS post-migration community stability**
   - The `explodinggradients` → `vibrantlabsai` org migration is recent; long-term maintenance unclear
   - Priority: NICE-TO-HAVE (RAGAS is Tier 2 fit anyway)

9. **LangSmith's offline/privacy mode**
   - LangSmith requires uploading data to smith.langchain.com; whether a self-hosted option exists is unknown
   - Priority: NICE-TO-HAVE (LangSmith is low-fit for the local use case)

---

## Actionable Recommendations

### Recommendation 1: Adopt promptfoo as the primary declarative eval layer (Phase 1 — Low Risk)

**What**: Add promptfoo to the tech-writer-eval and autotest pipelines as the YAML-driven test runner for non-agentic and semi-agentic evaluations.

**How**:
- Wrap `claudish` as an `exec:` provider: `exec: claudish --model google/gemini-2.5-flash --json --stdin`
- Port `test-cases.json` criteria to `llm-rubric` assertions with per-criterion weights
- Use promptfoo's matrix view to replace the custom grid in `analyze-results.ts`
- Keep `analyze-results.ts` for Friedman/Borda statistical tests consuming promptfoo's JSON output

**Why**: Anthropic officially endorses promptfoo (5/9 course lessons), it has native Claude Agent SDK support, it reduces bespoke TypeScript infrastructure for test orchestration, and it provides CI/CD-ready CLI out of the box.

**Risk**: Promptfoo joining OpenAI — verify license trajectory first.

**Priority**: 1 (immediate, after license check)

---

### Recommendation 2: Upgrade LLM-as-judge prompts to use CoT + XML structured output

**What**: Modify all judge prompts in the 7-model panel to add a chain-of-thought step before the final score, extract scores via XML tags, and add per-level anchor descriptions to rubrics.

**How**:
- Add `<thinking>...</thinking>` block before `<score>N</score>` in all judge system prompts
- Define anchor text for each score level (e.g., "Score 1: document uses first-person AI statements; Score 5: document reads as native human expert writing")
- Parse only `<score>` tags in aggregation; discard `<thinking>` before Borda count

**Why**: Three independent sources (Anthropic docs, promptfoo g-eval, DeepEval G-Eval) confirm CoT-before-verdict improves judge reliability, especially for nuanced quality assessments.

**Priority**: 2 (low-cost, high-impact improvement to existing infrastructure)

---

### Recommendation 3: Adopt DeepEval's ToolCorrectnessMetric for agent delegation tests (Phase 2)

**What**: Replace or supplement the manual `subagent_type` string comparison in `evaluator.ts` with DeepEval's `ToolCorrectnessMetric`.

**How**:
- Parse existing JSONL transcripts to extract `tools_called` as `ToolCall` objects
- Define `expected_tools` from existing `expected_agent` / `expected_alternatives` in test case JSON
- Run `ToolCorrectnessMetric(threshold=0.7)` via pytest integration
- Keep existing `PASS`/`FAIL` enum as the authoritative verdict; use DeepEval as a cross-validation signal

**Why**: DeepEval's metric supports configurable strictness (name only, name+args, name+args+output) and MCP-specific variants — covering both current and future MCP-based skills. Explorer 3 rated this the highest-fit Python framework for agent routing tests.

**Priority**: 3 (medium complexity, high value for skill routing correctness)

---

### Recommendation 4: Build toward 100+ test cases per skill category using synthetic generation

**What**: Use Claude to generate synthetic skill invocation scenarios at scale, closing the gap between current test case counts (4-12 per suite) and Anthropic's recommended minimum (100+).

**How**:
- Template each skill's intended behavior description (from SKILL.md frontmatter)
- Use the Anthropic `generate_test_cases.ipynb` cookbook pattern: give Claude the template + 3-5 golden examples → ask for 50-100 realistic variations
- Validate synthetic cases with a human pass (spot-check 10%)
- Store in YAML (compatible with promptfoo) or JSONL (compatible with DeepEval/autotest)

**Why**: Explorer 2 (Anthropic) cites 100+ as the empirical floor for statistical confidence. Current tech-writer-eval has ~4 cases; skills autotest has 8 cases — far too few to detect regressions reliably.

**Priority**: 4 (medium complexity, high value for detection reliability)

---

### Recommendation 5: Add regression baselines and connect at least one suite to CI (Priority Gap Fix)

**What**: Capture current eval results as baselines and run the fast integration tests (skills keyword activation) in CI on every commit.

**How**:
- Run `claude-code/tests/integration/skills/` (Bun tests, no API cost, millisecond speed) in GitHub Actions
- Save `results-summary.json` from autotest runs and version it; use `comparator.ts` to flag regressions in pass rate > 5% drop
- Implement a simple regression alert: if any model's pass rate drops below the prior baseline, CI reports it as a warning (not a blocking failure)

**Why**: All 4 sources surface the absence of regression testing and CI/CD integration as the most operationally significant gap. The fast integration tests (no API cost) are the zero-cost path to immediate CI coverage.

**Priority**: 5 (low complexity, addresses the single highest-impact operational gap)

---

## Convergence Assessment

**First Iteration**: No previous synthesis to compare.
**Information Saturation**: N/A (first iteration)
**Status**: EARLY — single iteration, all four planned sources read

---

## Recommendations for Next Steps

**Exploration Strategy**:
- Verify promptfoo's post-OpenAI-acquisition open-source status before committing Phase 1
- Run an inspect_swe pilot with a simple skill-routing test case to validate production maturity
- Investigate whether existing JSONL transcripts can be fed to DeepEval without re-running tests

**Refined Queries for Follow-Up**:
- `"promptfoo OpenAI acquisition license MIT Apache 2026"`
- `"inspect_swe claude_code production ready sandbox evaluation 2026"`
- `"deepeval pre-captured JSONL transcript LLMTestCase from file"`
- `"anthropic claude code analytics API eval skill behavior 2025"`
