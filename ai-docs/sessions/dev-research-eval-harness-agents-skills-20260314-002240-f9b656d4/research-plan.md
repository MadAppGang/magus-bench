# Research Plan: Evaluation Harnesses for Claude Code Agent Skills and Plugins

**Session:** dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4
**Date:** 2026-03-14
**Topic:** Evaluation infrastructure for testing Claude Code agent skills and plugins

---

## Background

The user has two relevant local repositories: `magus-bench` (a benchmarking sandbox with a working tech-writer eval using Borda count scoring) and `claude-code` (the Claude Code CLI with a substantial autotest framework and integration/E2E test suites for skills). The goal is to understand what eval infrastructure already exists, what external tools offer, and how they might combine into a comprehensive skill/plugin testing harness.

---

## Sub-Questions

### Q1. What eval infrastructure already exists locally?

**Priority:** 1 (highest — foundation for all other questions)

**Success Criteria:**
- Complete inventory of test runners, scoring mechanisms, and dataset patterns in both repos
- Understand the contract between `execute-test.sh`, the TypeScript evaluator/comparator/aggregator pipeline, and the judge panel pattern
- Identify gaps: what skill behaviors are tested, what are not, and what the harness cannot currently measure

**Sources:**
- LOCAL: `magus-bench/tech-writer-eval/` — execute-test.sh, Borda count logic, judge panel configuration
- LOCAL: `claude-code/autotest/framework/` — runner-base.sh, execute-test.sh, aggregator.ts, comparator.ts, evaluator.ts, replay.ts, types.ts
- LOCAL: `claude-code/autotest/` suite directories — subagents, team, skills, terminal, worktree, coaching, dev-loop, designer, code-roast, monitor
- LOCAL: `claude-code/tools/design-eval/` — Python toolkit, 4 datasets (~1,570 examples), adapter pattern
- LOCAL: `claude-code/tests/integration/skills/` — skill activation tests, dev, multimodel, agentdev, hooks
- LOCAL: `claude-code/tests/e2e/` — E2E skill activation scenarios

**Approach:** Read key framework files to understand data flow, then read a representative autotest suite to understand test shape. Cross-reference with integration and E2E tests to map coverage.

---

### Q2. What does promptfoo offer for prompt/LLM evaluation?

**Priority:** 2 (well-documented external tool; shapes how we think about structured eval)

**Success Criteria:**
- Understand promptfoo's test spec format (YAML/JSON), assertion types, and provider model
- Determine how promptfoo handles agentic/tool-use scenarios vs. simple prompt-response
- Identify whether promptfoo can drive Claude Code CLI invocations (claudish/claude -p pattern) as a provider
- Note any built-in graders (LLM-as-judge, regex, JSON schema, semantic similarity) relevant to skill output evaluation

**Sources:**
- WEB: promptfoo.dev docs — quickstart, configuration reference, assertion types, provider docs
- WEB: promptfoo GitHub (promptfoo/promptfoo) — examples directory, especially any agentic or CLI-provider examples
- WEB: npm/GitHub release notes for recent agentic eval additions

**Approach:** Survey docs top-down (concepts → config format → assertions → providers), then look for agent-specific examples. Note integration points with the local harness patterns.

---

### Q3. What does Anthropic's prompt evaluation course teach?

**Priority:** 3 (methodological grounding; informs scoring and rubric design)

**Success Criteria:**
- Identify the core evaluation methodology taught (human vs. LLM-as-judge, pairwise vs. absolute scoring, rubric construction)
- Extract any guidance on evaluating agentic or multi-turn interactions vs. single prompt-response
- Note recommended dataset sizes, split strategies, and iteration workflows
- Identify if the course references specific tooling (promptfoo, evals libraries, or custom scripts)

**Sources:**
- WEB: Anthropic's "Prompt Engineering" or "Building with Claude" course materials (courses.anthropic.com or learn.anthropic.com)
- WEB: Anthropic docs on evaluation (docs.anthropic.com/evaluation or similar)
- WEB: Any published Anthropic blog posts on eval methodology (anthropic.com/research or /news)

**Approach:** Read course outline/syllabus first to scope modules, then focus on the eval-specific module(s). Extract methodology patterns rather than code verbatim.

---

### Q4. What other open-source eval frameworks could test Claude Code skills/plugins?

**Priority:** 4 (broadens options; may reveal patterns not present in local infrastructure)

**Success Criteria:**
- Survey at least 3 additional frameworks beyond promptfoo (e.g., OpenAI Evals, EleutherAI lm-evaluation-harness, inspect-ai, brainlid/langchain evals, or HELM)
- For each: understand the test format, judge/scorer model, and whether it supports agentic/tool-use scenarios
- Identify one or two frameworks most compatible with the claudish/claude -p invocation pattern
- Note any frameworks with Borda count, ranked-choice, or pairwise comparison built in (given magus-bench's existing pattern)

**Sources:**
- WEB: GitHub — openai/evals, EleutherAI/lm-evaluation-harness, UKGovernmentBEIS/inspect-ai, BerriAI/litellm (for provider abstraction)
- WEB: Papers/blog posts on HELM (Holistic Evaluation of Language Models) — Stanford CRFM
- WEB: Any "awesome-llm-evaluation" curated lists on GitHub for framework discovery
- WEB: LangSmith / LangChain eval docs (as a contrasting hosted vs. local approach)

**Approach:** Start with a curated list search, then drill into the 3-4 most promising frameworks. Evaluate each against the criterion of supporting CLI-driven agentic invocations.

---

## Priority Ordering Summary

| Priority | Sub-Question | Rationale |
|----------|-------------|-----------|
| 1 | Local infrastructure inventory | Must understand what exists before knowing what to add |
| 2 | promptfoo capabilities | Most likely immediate integration candidate; concrete and well-documented |
| 3 | Anthropic eval course methodology | Informs scoring rubric design; methodology before tooling choices |
| 4 | Other OSS eval frameworks | Broadens perspective; lower priority since local + promptfoo may be sufficient |

---

## Cross-Cutting Concerns

These themes should be tracked across all four sub-questions:

- **LLM-as-judge patterns:** How is the judge model invoked, prompted, and scored? Does it use absolute scores, pairwise comparisons, or ranked lists?
- **Agentic test shape:** How does each framework handle multi-turn, tool-use, or filesystem-side-effect scenarios (vs. simple string output)?
- **CLI invocation compatibility:** Can the framework drive `claudish/claude -p` or similar subprocess invocations as a "model under test"?
- **Reproducibility:** Does the framework support replay/deterministic re-runs (as `replay.ts` does in claude-code/autotest)?
- **Dataset management:** How are test cases authored, versioned, and expanded over time?

---

## Expected Outputs per Sub-Question

Each sub-question should produce a findings file at:
`ai-docs/sessions/dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4/findings/q{N}-{slug}.md`

Final synthesis should produce:
`ai-docs/sessions/dev-research-eval-harness-agents-skills-20260314-002240-f9b656d4/synthesis/eval-harness-recommendation.md`
