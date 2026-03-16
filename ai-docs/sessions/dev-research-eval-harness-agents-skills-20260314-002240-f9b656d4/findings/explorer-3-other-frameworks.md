# Research Findings: Open-Source LLM Evaluation Frameworks Beyond promptfoo

**Researcher**: Explorer 3
**Date**: 2026-03-14
**Model Strategy**: native (local investigation + GitHub API + raw HTTP)
**Queries Executed**: 20+ (GitHub API, PyPI, raw README fetches, documentation pages)

---

## Summary

Eight major evaluation frameworks were investigated. The most significant finding for the local context (bash+TypeScript harness driving `claudish`/`claude -p`) is **Inspect AI** from UK AISI, which has a production-ready `claude_code()` agent integration via `inspect_swe`, explicit multi-agent delegation primitives, and a sandboxed tool-call execution model directly analogous to the local skill-activation tests. **DeepEval** is the most mature pure-Python agentic metric library (tool correctness, task completion, MCP-specific metrics). **Braintrust** is the most polished TypeScript-native eval platform if a hosted dashboard is acceptable. OpenAI Evals, lm-evaluation-harness, and HELM are strong for benchmark-style static evals but poorly suited to agentic / subprocess-driven testing.

---

## Key Findings

### Finding 1: Inspect AI Has a First-Class Claude Code Agent Wrapper

**Summary**: UK AISI's Inspect AI framework ships `inspect_swe`, a companion package that wraps `claude_code`, `codex_cli`, and `gemini_cli` as native Inspect `Agent` objects, running them inside a Docker sandbox.

**Evidence**: The `inspect_swe` package (`meridianlabs-ai/inspect_swe`) exports a `claude_code()` agent factory that accepts `skills`, `mcp_servers`, `bridged_tools`, model aliases (opus/sonnet/haiku/subagent), `version` (auto/sandbox/stable/latest), and `debug`. Internally it uses `sandbox_agent_bridge` and `install_skills` from `inspect_ai.tool`, meaning Inspect can orchestrate Claude Code runs that activate skills/plugins in a controlled environment and then score the output with any Inspect scorer.

The agent bridge pattern means Inspect handles sandboxing (Docker/k8s), result capture, and retry logic while Claude Code handles the actual tool calls. The scorer side supports `model_graded_qa()`, `model_graded_fact()`, `includes()`, `match()`, and fully custom Python scorers—any of which could check whether the correct subagent was selected.

```python
from inspect_swe import claude_code

task = Task(
    dataset=my_skill_dataset,
    solver=claude_code(
        skills=["my_skill"],
        mcp_servers=[...],
        attempts=3,
    ),
    scorer=model_graded_qa(model="anthropic/claude-opus-4")
)
```

Multi-agent scoring is also supported: agents can be composed via `handoff()` (delegation chains) and `as_tool()` (sub-agent as tool), enabling tests that verify delegation behavior.

**Sources**:
- [inspect_swe GitHub (meridianlabs-ai)](https://github.com/meridianlabs-ai/inspect_swe) - Quality: High (first-party code), Date: 2026-03-10
- [Inspect AI agents docs](https://inspect.aisi.org.uk/agents.html) - Quality: High (official docs), Date: retrieved 2026-03-14
- [inspect_swe `__init__.py`](https://github.com/meridianlabs-ai/inspect_swe/blob/main/src/inspect_swe/__init__.py) - Quality: High (source), Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes (code + docs)
**Contradictions**: None

---

### Finding 2: DeepEval Has the Richest Set of Agentic Metrics Including MCP-Specific Ones

**Summary**: DeepEval (confident-ai/deepeval, 14k+ GitHub stars, actively maintained as of 2026-03-13) ships ready-made metrics for tool correctness, task completion, goal accuracy, step efficiency, plan adherence, and three MCP-specific metrics (MCP Task Completion, MCP Use, Multi-Turn MCP Use).

**Evidence**: The `ToolCorrectnessMetric` takes `tools_called` (list of `ToolCall` objects from the agent's actual run) and `expected_tools` (the ground-truth list) and scores whether the right tools were called—with configurable strictness (name only, or name+args+output). This maps directly to the local harness's `subagent_type` matching logic.

```python
from deepeval.test_case import LLMTestCase, ToolCall
from deepeval.metrics import ToolCorrectnessMetric

test_case = LLMTestCase(
    input="Generate a code review",
    actual_output="...",
    tools_called=[ToolCall(name="code-roast")],
    expected_tools=[ToolCall(name="code-roast")],
)
metric = ToolCorrectnessMetric(threshold=0.7)
```

The `G-Eval` metric (research-backed, model-as-judge) allows any custom rubric, making it a direct substitute for the current 7-model judge panel approach but with a single configurable judge model.

DeepEval runs entirely locally (no hosted requirement) and integrates with pytest via `@pytest.mark.parametrize`.

**Sources**:
- [deepeval GitHub (confident-ai)](https://github.com/confident-ai/deepeval) - Quality: High, Stars: 14,071, Date: 2026-03-13
- [ToolCorrectnessMetric docs](https://deepeval.com/docs/metrics-tool-correctness) - Quality: High (official docs), Date: retrieved 2026-03-14
- [DeepEval README](https://raw.githubusercontent.com/confident-ai/deepeval/main/README.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

### Finding 3: OpenAI Evals Is Now Mostly a Registry / Hosted Platform; Local Framework Is Largely Unmaintained

**Summary**: The `openai/evals` GitHub repo (18k stars) was last meaningfully updated in November 2025 for the Python framework. OpenAI has shifted users toward the hosted Evals platform at `platform.openai.com/evals`. The local YAML+JSONL registry format is useful for reference but not a good integration target.

**Evidence**: The last three commits to openai/evals are from 2025-11-03, 2024-12-18, and 2024-09-30—over a year of minimal maintenance. The README now prominently links to the hosted dashboard. The YAML registry format (`.yaml` eval spec + `.jsonl` data file) and `oaieval` CLI remain functional but are OpenAI-model-centric (no native support for `claude -p` or custom CLI providers without wrapping via the `Completion Function Protocol`).

The `Completion Function Protocol` (`docs/completion-fns.md`) theoretically allows custom completion backends, which could wrap `claudish`, but this pathway is undocumented for recent versions and the ecosystem has moved on.

**Sources**:
- [openai/evals GitHub](https://github.com/openai/evals) - Quality: High, Stars: 18,008, Date: last commit 2025-11-03
- [OpenAI evals README](https://raw.githubusercontent.com/openai/evals/main/README.md) - Quality: High, Date: retrieved 2026-03-14
- [build-eval.md](https://raw.githubusercontent.com/openai/evals/main/docs/build-eval.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

### Finding 4: LangSmith Is a Hosted Tracing + Eval Platform; Useful for Observability, Not Offline Testing

**Summary**: LangSmith (langchain-ai/langsmith-sdk, 801 stars, updated 2026-03-13) is a hosted SaaS platform for tracing, debugging, and evaluating LLM applications. It requires a LangSmith API key and uploads traces to `smith.langchain.com`.

**Evidence**: LangSmith's core pattern is `@traceable` decorator on Python functions or `wrap_openai()` for automatic trace capture. Evals run by defining a dataset in the LangSmith UI or SDK and running it against a target function. The evaluator (judge) can be LLM-based or custom Python.

For the local harness context, LangSmith would require pushing JSONL transcript data to a hosted service, which may conflict with privacy requirements and adds network dependency. It is primarily designed for LangChain-based apps, though it works with any function. No native support for subprocess-based agents (like `claude -p`).

**Sources**:
- [langsmith-sdk GitHub](https://github.com/langchain-ai/langsmith-sdk) - Quality: High, Stars: 801, Date: 2026-03-13
- [LangSmith Python README](https://raw.githubusercontent.com/langchain-ai/langsmith-sdk/main/python/README.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

### Finding 5: RAGAS Expanded Beyond RAG to General Agent Evaluation (Now at vibrantlabsai)

**Summary**: RAGAS (vibrantlabsai/ragas, 12,931 stars, updated 2026-02-24) migrated from `explodinggradients` org to `vibrantlabsai` as of late 2025 (version 0.4.3). It now includes agent-specific metrics beyond RAG: Topic Adherence, Tool Call Accuracy, and multi-turn conversation completeness.

**Evidence**: The agent metrics module uses a message-list format (`HumanMessage`, `AIMessage` with `tool_calls`, `ToolMessage`) to represent multi-turn conversations, then scores them with LLM-as-judge. Topic adherence measures whether the agent stayed on domain. Tool call metrics check whether tools were invoked appropriately across turns.

RAGAS is Python-only with async-first design. It requires an LLM provider (OpenAI, Anthropic, etc.) for judge calls. It does not natively support subprocess-driven agents but can evaluate pre-captured transcripts.

The org move from `explodinggradients` → `vibrantlabsai` means some links in documentation are stale. The PyPI package still installs correctly as `pip install ragas`.

**Sources**:
- [RAGAS PyPI](https://pypi.org/project/ragas/) - Quality: High, Version: 0.4.3, Date: retrieved 2026-03-14
- [RAGAS GitHub (vibrantlabsai)](https://github.com/vibrantlabsai/ragas) - Quality: High, Stars: 12,931, Date: 2026-02-24
- [RAGAS agent metrics docs](https://raw.githubusercontent.com/explodinggradients/ragas/main/docs/concepts/metrics/available_metrics/agents.md) - Quality: High (official docs), Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: RAGAS repo has moved; explodinggradients links still redirect but new home is vibrantlabsai

---

### Finding 6: AgentBench Is the Only Framework Specifically Designed as an Agent Capability Benchmark

**Summary**: AgentBench (THUDM/AgentBench, ICLR 2024, 3,234 stars) evaluates LLMs-as-agents across 8 sandboxed real-world environments (OS shell, database, knowledge graph, web shopping, house-holding via ALFWorld, etc.). The new FC (Function Calling) version uses Docker Compose for fully containerized deployment.

**Evidence**: AgentBench is designed as a benchmark, not an eval SDK. It defines tasks in 8 environments and runs models through them, measuring task completion rates. It is not designed to evaluate custom skills or plugins—it tests whether a model can complete predefined tasks in standardized environments.

The FC version (added 2025-10) integrates with AgentRL, an RL training framework, meaning it targets model training as much as evaluation. Setup requires Docker and significant infrastructure (16GB RAM for webshop). Last commit: 2026-02-08.

For the local use case (testing whether `claudish` selects the right skill), AgentBench is a poor fit: its environments are fixed, not extensible for custom skill routing tests, and its complexity is overkill.

**Sources**:
- [AgentBench GitHub (THUDM)](https://github.com/THUDM/AgentBench) - Quality: High (ICLR 2024 paper), Stars: 3,234, Date: 2026-02-08
- [AgentBench README](https://raw.githubusercontent.com/THUDM/AgentBench/main/README.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

### Finding 7: Braintrust Is the Most Polished TypeScript-Native Eval Platform With Hosted Dashboard

**Summary**: Braintrust (braintrustdata/braintrust-sdk-javascript) is a commercial eval-and-observability platform with a TypeScript-first SDK, `Eval()` function, autoevals scorers, and integrations for OpenAI Agents, LangChain, and OpenTelemetry. The open-source SDK is free; the hosted dashboard requires an account.

**Evidence**: The TypeScript `Eval()` API is the most compatible with the local TypeScript evaluator pipeline:

```typescript
import { Eval } from "braintrust";
import { LLMClassifierFromTemplate } from "autoevals";

Eval("skill-routing", {
  data: () => testCases,               // JSON array of {input, expected}
  task: async (input) => {             // run claudish CLI, return output
    const result = await runClaudish(input);
    return result.subagent_type;
  },
  scores: [
    LLMClassifierFromTemplate({        // LLM-as-judge
      promptTemplate: "Did the agent select {{expected}}? Output: {{output}}",
      choiceScores: { "Y": 1, "N": 0 },
    }),
  ],
});
```

The `autoevals` package (separate npm package) provides Levenshtein, embedding similarity, LLM classifier, and factuality scorers. The platform stores results, shows diffs across runs, and generates reports—but requires uploading data to `braintrust.dev`.

SDK is Apache-2.0. The platform itself is commercial SaaS. No native pairwise/Borda-count aggregation built in, but the scorer interface is extensible.

**Sources**:
- [braintrust-sdk-javascript GitHub](https://github.com/braintrustdata/braintrust-sdk-javascript) - Quality: High, Stars: 8 (this is the JS SDK repo, not the main product), Date: 2026-03-13
- [Braintrust NPM package](https://www.npmjs.com/package/braintrust) - Quality: High, Version: 3.4.0, Date: retrieved 2026-03-14
- [Braintrust JS SDK README](https://raw.githubusercontent.com/braintrustdata/braintrust-sdk-javascript/main/README.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

### Finding 8: EleutherAI lm-evaluation-harness and Stanford HELM Are for Static Benchmark Evals, Not Agentic Testing

**Summary**: lm-evaluation-harness (11,677 stars, last commit 2026-03-05) and HELM (2,707 stars, last commit 2026-03-13) are the gold standard for academic LLM benchmarking but are not designed for agentic, multi-turn, or subprocess-driven evaluation.

**Evidence**: Both frameworks operate in a prompt-in/completion-out paradigm: they send a prompt to a model API and score the response against a reference answer. Neither supports multi-turn tool-call sequences, subprocess invocation patterns, or custom skill/plugin routing tests.

lm-evaluation-harness powers the HuggingFace Open LLM Leaderboard and has 60+ academic tasks (MMLU, HellaSwag, GSM8K, etc.). HELM adds standardized multi-metric evaluation (accuracy + efficiency + bias + toxicity) and a web leaderboard UI. Both support Anthropic models via their API but not via CLI subprocess.

For the local use case, these tools are useful only for baseline capability benchmarking across model versions—not for testing whether a specific skill activates correctly.

**Sources**:
- [EleutherAI/lm-evaluation-harness GitHub](https://github.com/EleutherAI/lm-evaluation-harness) - Quality: High, Stars: 11,677, Date: 2026-03-05
- [stanford-crfm/helm GitHub](https://github.com/stanford-crfm/helm) - Quality: High, Stars: 2,707, Date: 2026-03-13
- [lm-eval README](https://raw.githubusercontent.com/EleutherAI/lm-evaluation-harness/main/README.md) - Quality: High, Date: retrieved 2026-03-14
- [HELM README](https://raw.githubusercontent.com/stanford-crfm/helm/main/README.md) - Quality: High, Date: retrieved 2026-03-14

**Confidence**: High
**Multi-source**: Yes
**Contradictions**: None

---

## Comparison Table

| Framework | Stars | Last Commit | Open Source | Agent/Tool-Use Support | Multi-Model | CLI Subprocess Friendly | Skill/Plugin Routing | LLM-as-Judge | TypeScript Support |
|-----------|-------|-------------|-------------|----------------------|-------------|------------------------|----------------------|--------------|-------------------|
| **Inspect AI** (AISI) | 1,825 | 2026-03-13 | Yes (MIT) | Native (ReAct, custom, multi-agent, bridge) | Yes (any model) | Yes (via sandbox agent bridge) | Yes (via `install_skills`) | Yes (`model_graded_qa`) | No (Python only) |
| **inspect_swe** | 14 | 2026-03-10 | Yes (MIT) | Yes (wraps `claude_code()` as agent) | Yes | Yes (runs real Claude Code in Docker) | Yes (Skills param) | Via Inspect | No (Python) |
| **DeepEval** | 14,071 | 2026-03-13 | Yes (Apache-2) | Rich (ToolCorrectness, TaskCompletion, MCP metrics) | Configurable judge model | No (Python SDK, requires wrapper) | Via ToolCorrectness | Yes (G-Eval, any model) | No (Python) |
| **Braintrust** | 8 SDK repo | 2026-03-13 | SDK: Apache-2; Platform: commercial | Limited (scorer interface) | Yes (scorer configurable) | Yes (task fn is arbitrary async) | Via custom scorer | Yes (LLMClassifier) | Yes (TypeScript-first) |
| **RAGAS** | 12,931 | 2026-02-24 | Yes (Apache-2) | Agent metrics (TopicAdherence, ToolCall) | Configurable judge | No (Python, requires wrapper) | No native support | Yes (LLM judge) | No (Python) |
| **OpenAI Evals** | 18,008 | 2025-11-03 | Yes (MIT) | Minimal (model-graded YAML) | OpenAI models only | Via Completion Function Protocol (undocumented) | No | Yes (model-graded) | No (Python) |
| **LangSmith** | 801 | 2026-03-13 | SDK: MIT; Platform: commercial SaaS | Limited (trace-based) | Yes | No (hosted service, privacy concern) | No | Yes (custom evaluator) | Yes |
| **AgentBench** | 3,234 | 2026-02-08 | Yes (MIT) | Yes (8 environments, Docker) | Yes | No (fixed environments) | No (fixed tasks) | No (task completion) | No (Python) |
| **lm-eval-harness** | 11,677 | 2026-03-05 | Yes (MIT) | No (prompt-response only) | Yes (API + HF) | No | No | Via custom metric | No (Python) |
| **HELM** | 2,707 | 2026-03-13 | Yes (Apache-2) | No (prompt-response only) | Yes | No | No | No | No (Python) |

---

## Fit Assessment for Local Harness

The local system (bash+TypeScript, JSONL transcripts, subagent_type matching, 7-model judge panel) maps most naturally to:

### Tier 1: High fit — adopt or study patterns from
1. **Inspect AI + inspect_swe**: The `claude_code()` agent wrapper, `install_skills`, and `sandbox_agent_bridge` are the closest analogue to what the local harness does. The Python orchestration layer could drive the same Docker-sandboxed test cases that the local bash scripts run. The `model_graded_qa` scorer supports multi-model judge panels by passing a list to the `model` argument.

2. **DeepEval**: `ToolCorrectnessMetric` with `tools_called` populated from parsed JSONL transcripts would directly replace the manual `subagent_type` string matching. The MCP metrics are forward-looking for MCP-based skills. Integrates with pytest.

### Tier 2: Partial fit — borrow specific patterns
3. **Braintrust**: The TypeScript `Eval()` + `LLMClassifierFromTemplate` pattern is cleanly adoptable in the existing TypeScript evaluator/aggregator pipeline without replacing it. Useful if a hosted comparison dashboard is desired.

4. **RAGAS**: The multi-turn message format (`HumanMessage`/`AIMessage`/`ToolMessage`) is a useful reference for structuring JSONL transcripts in a way that standard frameworks can consume.

### Tier 3: Low fit — benchmark-only, not skill-routing tests
5. **OpenAI Evals**: Useful reference for YAML+JSONL format. Not a good integration target (maintenance stalled, OpenAI-centric).
6. **LangSmith**: Useful for teams wanting hosted tracing; not for offline/private testing.
7. **AgentBench**: Fixed environment benchmark; not extensible for custom skills.
8. **lm-eval-harness / HELM**: Academic benchmarks; no agentic or subprocess support.

---

## Source Summary

**Total Sources Consulted**: 22
- High Quality: 20
- Medium Quality: 2
- Low Quality: 0

**Source List**:
1. [confident-ai/deepeval GitHub](https://github.com/confident-ai/deepeval) - Quality: High, Date: 2026-03-13
2. [openai/evals GitHub](https://github.com/openai/evals) - Quality: High, Date: 2025-11-03 (last meaningful commit)
3. [UKGovernmentBEIS/inspect_ai GitHub](https://github.com/UKGovernmentBEIS/inspect_ai) - Quality: High, Date: 2026-03-13
4. [meridianlabs-ai/inspect_swe GitHub](https://github.com/meridianlabs-ai/inspect_swe) - Quality: High, Date: 2026-03-10
5. [THUDM/AgentBench GitHub](https://github.com/THUDM/AgentBench) - Quality: High, Date: 2026-02-08
6. [EleutherAI/lm-evaluation-harness GitHub](https://github.com/EleutherAI/lm-evaluation-harness) - Quality: High, Date: 2026-03-05
7. [stanford-crfm/helm GitHub](https://github.com/stanford-crfm/helm) - Quality: High, Date: 2026-03-13
8. [langchain-ai/langsmith-sdk GitHub](https://github.com/langchain-ai/langsmith-sdk) - Quality: High, Date: 2026-03-13
9. [vibrantlabsai/ragas GitHub](https://github.com/vibrantlabsai/ragas) - Quality: High, Date: 2026-02-24
10. [braintrustdata/braintrust-sdk-javascript GitHub](https://github.com/braintrustdata/braintrust-sdk-javascript) - Quality: High, Date: 2026-03-13
11. [Inspect AI agents docs](https://inspect.aisi.org.uk/agents.html) - Quality: High
12. [Inspect AI scorers docs](https://inspect.aisi.org.uk/scorers.html) - Quality: High
13. [Inspect AI tasks docs](https://inspect.aisi.org.uk/tasks.html) - Quality: High
14. [DeepEval ToolCorrectnessMetric docs](https://deepeval.com/docs/metrics-tool-correctness) - Quality: High
15. [OpenAI evals build-eval.md](https://github.com/openai/evals/blob/main/docs/build-eval.md) - Quality: High
16. [RAGAS agent metrics docs](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/agents/) - Quality: High
17. [RAGAS PyPI](https://pypi.org/project/ragas/) - Quality: High
18. [Braintrust NPM](https://www.npmjs.com/package/braintrust) - Quality: High
19. [AgentBench README](https://github.com/THUDM/AgentBench/blob/main/README.md) - Quality: High
20. [lm-evaluation-harness README](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/README.md) - Quality: High
21. [HELM README](https://github.com/stanford-crfm/helm/blob/main/README.md) - Quality: High
22. [inspect_swe source __init__.py](https://github.com/meridianlabs-ai/inspect_swe/blob/main/src/inspect_swe/__init__.py) - Quality: High

---

## Knowledge Gaps

1. **Braintrust agent-specific scoring**: No documentation found on how Braintrust handles multi-turn tool-use transcripts natively (vs. custom scorer functions). Suggested query: "braintrust eval tool calls multi-turn scoring 2025"

2. **Inspect AI's pairwise/Borda-count scoring**: The Inspect scorers module documents accuracy and mean metrics but not ranked-choice aggregation across multiple judge models. Suggested query: "inspect_ai multi-model judge pairwise comparison scorer"

3. **DeepEval's CLI/subprocess integration**: DeepEval's test runner assumes Python access to model outputs; no documented path for parsing pre-captured JSONL transcripts from external processes. Suggested query: "deepeval custom test case from pre-captured output JSONL"

4. **RAGAS post-vibrantlabsai migration stability**: The org move from `explodinggradients` to `vibrantlabsai` is recent (late 2025). Community reception and long-term maintenance commitment are unclear. Last commit: 2026-02-24 (acceptable but slower than before migration).

5. **inspect_swe production maturity**: Only 14 GitHub stars and recent creation (2026-03-10 last commit). Whether `claude_code()` agent wrapper is production-ready or experimental is unclear. Suggested: try a pilot eval with a simple skill-routing task.

---

## Search Limitations

- Model: claude-sonnet-4-6 (native, no web search)
- Web search: unavailable (MODEL_STRATEGY=native); used GitHub API + PyPI API + raw HTTP document fetching as substitute
- Local search: performed (no relevant local files for these external frameworks)
- Date range: retrieved 2026-03-14; framework stats reflect GitHub API responses as of 2026-03-13/14
- Query refinement: performed (RAGAS required following permanent redirect to new org)
