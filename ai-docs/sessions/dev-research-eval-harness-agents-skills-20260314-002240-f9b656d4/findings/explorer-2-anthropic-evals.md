# Research Findings: Anthropic Prompt Evaluation Course and Recommended Eval Patterns

**Researcher:** Explorer 2
**Date:** 2026-03-14
**Model Strategy:** native (local + direct HTTP fetch)
**Queries Executed:** 14 HTTP fetches across GitHub, Anthropic docs, and official course notebooks

---

## Key Findings

---

### Finding 1: The Course Structure — Nine Lessons Covering the Full Eval Stack

**Summary:** Anthropic's `prompt_evaluations` course in the `anthropics/courses` GitHub repo has nine lessons progressing from eval theory to code-graded, classification, model-graded, and custom-graded evals using promptfoo.

**Evidence:**

The course is hosted at `https://github.com/anthropics/courses/tree/master/prompt_evaluations` and consists of:

1. Evaluations 101 — what evals are and why they matter
2. Human-graded evals with Anthropic's Workbench
3. Simple code-graded evals (exact string match)
4. Classification evals (keyword/set-membership grading)
5. Promptfoo introduction — code-graded
6. Classification evals with promptfoo
7. Custom code-graders with promptfoo (Python `get_assert()`)
8. Model-graded evals with promptfoo (`llm-rubric` assertion)
9. Custom model-graded evals with promptfoo (multi-metric rubric scoring)

The framing throughout: evals exist to quantify the prompt+model quality so that prompt changes can be validated empirically. Anthropic's internal Solutions Architects quote: "the inability for teams to measure performance is the biggest blocker of production use cases" and "doing evals up front saves developer time in the long run."

**Sources:**
- [courses/prompt_evaluations/README.md](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/README.md) — Quality: High (official Anthropic repo), Date: 2024-2025
- [01_intro_to_evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/01_intro_to_evals/01_intro_to_evals.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes (README + notebook contents)

---

### Finding 2: Four-Component Eval Anatomy

**Summary:** Anthropic consistently defines an eval as having four components: Example Input, Golden Answer, Model Output, and Score. The golden answer may be an exact expected output or a rubric for grading.

**Evidence:**

From the intro lesson (Lesson 1) and the `building_evals.ipynb` cookbook recipe:

> "A well-designed prompt evaluation consists of four primary components: Example Input, Golden Answer, Model Output, Score."

The golden answer is described as "the correct or ideal response serves as a benchmark." For open-ended tasks the golden answer becomes a *rubric* — a description of what a correct answer must include — rather than a literal string. For example:
```
golden_answer: "A correct answer should include a workout plan with 50 or more reps of
pulling leg exercises (such as deadlifts), 50 or more reps of pulling arm exercises, and
ten minutes of core workouts."
```

Anthropic recommends at least **100 test-case/golden-answer pairs** for reliable results.

**Sources:**
- [01_intro_to_evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/01_intro_to_evals/01_intro_to_evals.ipynb) — Quality: High
- [misc/building_evals.ipynb](https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/building_evals.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes (course + cookbook reinforce each other)

---

### Finding 3: Grading Hierarchy — Choose the Fastest Reliable Method

**Summary:** Anthropic advocates a tiered grading strategy: code-graded first, LLM-graded when code falls short, human grading only as a last resort.

**Evidence:**

From the official docs page (`docs.anthropic.com/en/docs/test-and-evaluate/develop-tests`):

> "When deciding which method to use to grade evals, choose the fastest, most reliable, most scalable method."

The hierarchy they describe:

| Method | Speed | Scalability | Nuance | Use When |
|--------|-------|-------------|--------|----------|
| Code-based grading | Fastest | Highest | Low | Task has objective, deterministic outputs |
| LLM-based grading | Fast | High | High | Subjective, open-ended, or multi-criteria tasks |
| Human grading | Slowest | Lowest | Highest | Gold-standard calibration; avoid in production |

Code-grading subtypes taught:
- **Exact string match:** `output == golden_answer`
- **Keyword presence:** `key_phrase in output`
- **Regex patterns:** for structured output validation
- **Set membership:** for multi-label classification (checking if required labels appear in output)

**Sources:**
- [Anthropic docs: Define success and build evaluations](https://docs.anthropic.com/en/docs/test-and-evaluate/develop-tests) — Quality: High
- [01_intro_to_evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/01_intro_to_evals/01_intro_to_evals.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes

---

### Finding 4: LLM-as-Judge — Rubric-Based with Structured Reasoning

**Summary:** Anthropic's recommended LLM-as-judge pattern uses detailed rubrics, structured binary or ordinal output, and chain-of-thought reasoning before the final grade. The judge's reasoning is discarded; only the structured verdict is kept.

**Evidence:**

From the official docs, four explicit tips for LLM-based grading:

1. **Detailed, clear rubrics:** "The answer should always mention Acme Inc. in the first sentence. If it does not, the answer is automatically graded as incorrect."
2. **Empirical/specific outputs:** "Instruct the LLM to output only 'correct' or 'incorrect', or to judge from a scale of 1-5. Purely qualitative evaluations are hard to assess quickly and at scale."
3. **Encourage reasoning first:** "Ask the LLM to think first before deciding an evaluation score, and then discard the reasoning. This increases evaluation performance, particularly for tasks requiring complex judgement."
4. **Multiple rubrics per use case:** "A given use case, or even a specific success criteria for that use case, might require several rubrics for holistic evaluation."

The cookbook's `building_evals.ipynb` shows the canonical grader prompt pattern:
```python
def build_grader_prompt(answer, rubric):
    # ...
    """Think through whether the answer is correct or incorrect based on the rubric
    inside <thinking></thinking> tags. Then, output either 'correct' if the answer is
    correct or 'incorrect' if the answer is incorrect inside <correctness></correctness> tags."""
```

The judge's `<thinking>` output is parsed and discarded; only the `<correctness>` tag content is extracted and counted.

For **multi-dimensional scoring** (Lesson 9, `custom_llm_eval.py`), Anthropic demonstrates scoring on three independent 1-5 Likert scales (Conciseness, Accuracy, Tone) with anchor descriptions at levels 1, 3, and 5. Scores are averaged and compared to a pass threshold (e.g., 4.5/5.0).

**Sources:**
- [Anthropic docs: Grade your evaluations](https://docs.anthropic.com/en/docs/test-and-evaluate/develop-tests#grade-your-evaluations) — Quality: High
- [misc/building_evals.ipynb](https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/building_evals.ipynb) — Quality: High
- [09_custom_model_graded_prompt_foo notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/09_custom_model_graded_prompt_foo/lesson.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes (docs + cookbook + course all consistent)

---

### Finding 5: Scoring Methods — Binary, Ordinal (1-5), Pass/Fail Thresholds

**Summary:** Anthropic uses binary (correct/incorrect), 1-5 Likert scale, and threshold-based pass/fail scoring. Pairwise/ranking comparisons are not explicitly taught in this course but are supported by promptfoo's built-in assertion types.

**Evidence:**

**Binary scoring** is the most common pattern: `correct` / `incorrect`, extracted via regex from XML tags. This maps directly to a percentage accuracy score.

**Ordinal 1-5 scoring** appears in Lesson 9 for multi-dimensional quality evals:
```
Conciseness (1-5): 1=unnecessarily long, 3=mostly focused, 5=perfectly concise
Accuracy (1-5): 1=significant errors, 3=minor inaccuracies, 5=faithful to source
Tone (1-5): 1=too technical, 3=mostly appropriate, 5=perfectly grade-school appropriate
```
Scores are averaged into a single float; pass threshold is set by the developer (example: 4.5/5.0).

**Workbench human grading** (Lesson 2) uses a 5-point scale (score 1-5) that humans assign manually, then compares v1 vs v2 side by side.

**Promptfoo's `llm-rubric`** assertion returns `pass: boolean` and `score: float`. Custom Python `get_assert()` must return a `GradingResult` dict with `pass`, `score`, and `reason` fields.

The course does **not** explicitly cover pairwise/ranking/Borda count patterns. Those are not in the Anthropic curriculum but are supported as custom graders via the `get_assert()` function interface.

**Sources:**
- [09_custom_model_graded_prompt_foo notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/09_custom_model_graded_prompt_foo/lesson.ipynb) — Quality: High
- [08_prompt_foo_model_graded notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/08_prompt_foo_model_graded/lesson.ipynb) — Quality: High
- [02_workbench_evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/02_workbench_evals/02_workbench_evals.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes

---

### Finding 6: Promptfoo Is Anthropic's Recommended External Eval Tool

**Summary:** Anthropic dedicates five of nine course lessons to promptfoo, making it the de facto recommended eval framework. The course teaches promptfoo as the path from "ad hoc scripts" to "production-scale evals."

**Evidence:**

Lessons 5-9 all use promptfoo. Key promptfoo patterns taught:

**YAML configuration:**
```yaml
providers: [anthropic:messages:claude-3-5-sonnet-20240620]
prompts:
  - prompts.py:my_prompt_function
tests:
  - vars:
      input: "some value"
defaultTest:
  assert:
    - type: llm-rubric
      provider: anthropic:messages:claude-3-opus-20240229
      value: 'Refuses to answer the question and redirects to academic topics'
```

**Built-in assertion types** used in the course:
- `exact-match` — string equality
- `contains-all` — all keywords present
- `llm-rubric` — LLM-as-judge with natural language criteria
- `python` — custom Python `get_assert()` function

**Multi-prompt comparison:** promptfoo natively runs all prompts across all test cases and displays results in a matrix view, making A/B prompt comparison straightforward.

**Model comparison:** Multiple providers can be listed; promptfoo runs all test/prompt combos against all providers in one sweep.

The course notes that promptfoo is "one open source and easy to use option" and mentions competing tools (Vellum, Scale Evaluation, PromptLayer, ChainForge) but only teaches promptfoo.

**Sources:**
- [05_prompt_foo_code_graded_animals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/05_prompt_foo_code_graded_animals/lesson.ipynb) — Quality: High
- [08_prompt_foo_model_graded notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/08_prompt_foo_model_graded/lesson.ipynb) — Quality: High
- [09_custom_model_graded_prompt_foo notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/09_custom_model_graded_prompt_foo/lesson.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes

---

### Finding 7: Chain-of-Thought Prompting Is Validated Through Evals (Not Just Assumed)

**Summary:** The course uses the eval loop to empirically demonstrate that chain-of-thought (CoT) prompting improves accuracy on multi-step reasoning tasks, raising accuracy from 66% to 100% in the demo. This frames CoT as a hypothesis to be validated rather than a guaranteed improvement.

**Evidence:**

Lesson 3 walks through three prompt versions on a "how many legs" task:
- Prompt v1 (basic): 66.6% accuracy — formatting issues, wrong answers on multi-step math
- Prompt v2 (output-constrained): improved but still wrong on tricky inputs
- Prompt v3 (CoT with `<thinking>` + `<answer>` tags): 100% accuracy

The CoT pattern used:
```python
"""Start by reasoning step by step inside <thinking> tags.
Then output your final answer inside <answer> tags.
Inside <answer> return just the number as an integer and nothing else."""
```

The grader uses regex to extract only the `<answer>` tag content, discarding the `<thinking>` output. This same pattern is recommended for LLM-as-judge evaluators.

**Key lesson:** The eval framework itself is what gives you the evidence that CoT helped. Without the eval, you'd have anecdotes.

**Sources:**
- [03_code_graded_evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/03_code_graded_evals/03_code_graded.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** No (single lesson, but clearly demonstrated)

---

### Finding 8: Anthropic Has a Separate Published Eval Dataset Repo for Model Behavior Testing

**Summary:** `anthropics/evals` on GitHub contains model-written evaluation datasets for testing model behaviors (persona, sycophancy, advanced AI risk, gender bias). This is distinct from the "how to run evals on your app" course and targets safety/alignment properties at the model level.

**Evidence:**

The `anthropics/evals` repository (https://github.com/anthropics/evals) contains:
- `persona/` — 100+ JSONL files testing for stated political/religious views, personality traits, and goal-seeking behaviors (power-seeking, self-replication, deception, etc.)
- `sycophancy/` — datasets measuring whether the model echoes user views on philosophy, NLP, and politics
- `advanced-ai-risk/` — testing for corrigibility, coordination-seeking, myopic reward, self-awareness
- `winogenerated/` — occupational gender bias (based on Winogender)

These datasets are framed as `(question, yes/no)` pairs fed to a dialogue agent. The methodology is described in the paper "Discovering Language Model Behaviors with Model-Written Evaluations" (Perez et al., arXiv:2212.09251). The key technique: use one LLM to *generate* eval questions about another LLM's behaviors, then use humans to validate a sample.

This is **not** the same as the prompt eval course — it is safety/alignment evaluation infrastructure for model developers.

**Sources:**
- [anthropics/evals README](https://raw.githubusercontent.com/anthropics/evals/main/README.md) — Quality: High (official Anthropic repo), Date: 2022-2024
- [arXiv:2212.09251](https://arxiv.org/abs/2212.09251) — Quality: High (peer-reviewed paper)

**Confidence:** High
**Multi-source:** Yes

---

### Finding 9: Success Criteria Design — SMART Metrics, Multidimensional, Task-Specific

**Summary:** Anthropic's official docs provide a structured framework for defining eval success criteria before writing any test cases. The framework mirrors SMART goal design and explicitly addresses quantifying even qualitative criteria.

**Evidence:**

From `docs.anthropic.com/en/docs/test-and-evaluate/develop-tests`, Anthropic defines good success criteria as:

- **Specific:** "accurate sentiment classification" not "good performance"
- **Measurable:** "Less than 0.1% of outputs out of 10,000 trials flagged for toxicity by our content filter" not "safe outputs"
- **Achievable:** Based on industry benchmarks or prior art
- **Relevant:** Aligned with the application's purpose and user needs

Common criteria listed (non-exhaustive):
- Task fidelity, Consistency, Relevance and coherence, Tone and style, Privacy preservation, Context utilization, Latency, Price

**Eval design principles:**
- Be task-specific: "Design evals that mirror your real-world task distribution. Don't forget edge cases."
- Automate when possible: structure for code-graded or LLM-graded over human-graded
- Prioritize volume: "More questions with slightly lower signal automated grading is better than fewer questions with high-quality human hand-graded evals"

For generating test cases at scale: Anthropic recommends using Claude itself via the `misc/generate_test_cases.ipynb` cookbook recipe, which templates Claude to synthesize realistic input variable values from a prompt template and optional golden examples.

**Sources:**
- [Anthropic docs: Define success and build evaluations](https://docs.anthropic.com/en/docs/test-and-evaluate/develop-tests) — Quality: High
- [misc/generate_test_cases.ipynb](https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/generate_test_cases.ipynb) — Quality: High

**Confidence:** High
**Multi-source:** Yes

---

### Finding 10: Agent/Tool-Use Eval Patterns — Not Covered in the Prompt Eval Course

**Summary:** The 9-lesson course and main cookbook recipes cover only single prompt-response evals. There is no explicit Anthropic course content on evaluating multi-step agents, tool-use chains, or agentic side-effects. Custom `get_assert()` in promptfoo is the closest official path for extending to agentic scenarios.

**Evidence:**

All course examples are single-turn: one input, one output, one score. The most complex case is multi-metric scoring of a summarization task, but it is still single-turn (article in, summary out).

The `anthropics/evals` repo addresses model-level behavioral properties (does the model want to acquire power?) but those are also single-turn multiple-choice prompts, not execution traces.

The promptfoo `get_assert()` Python function pattern (Lessons 7, 9) is the most extensible mechanism: it receives `output` (the model's text response) and `context` (all variables and prompt metadata), allowing arbitrary Python logic for scoring. An agent eval harness could:
1. Use Claude CLI / claudish as the promptfoo `provider`
2. Capture the agent's final output text as `output`
3. Implement `get_assert()` to inspect file system state, tool call logs, or structured output fields

The Anthropic SDK Agent SDK documentation references evaluation patterns for agents but the corresponding detailed docs pages returned 404 at research time, suggesting that agent-specific eval guidance is either nascent or locked behind newer documentation structure.

**Knowledge gap:** No official Anthropic course content on agentic eval patterns (multi-turn, tool-use, side-effect verification). Community resources (Inspect AI, OpenAI evals format) may fill this gap.

**Sources:**
- [09_custom_model_graded_prompt_foo notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/09_custom_model_graded_prompt_foo/lesson.ipynb) — Quality: High
- Anthropic docs agentic eval URL (returned 404) — Quality: N/A

**Confidence:** Medium (negative finding — confirmed absence)
**Multi-source:** No

---

## Source Summary

**Total Sources:** 11 distinct sources
- High Quality: 10
- Medium Quality: 1
- Low Quality: 0

**Source List:**

| # | Source | Quality | Date | Type |
|---|--------|---------|------|------|
| 1 | [courses/prompt_evaluations README](https://github.com/anthropics/courses/tree/master/prompt_evaluations) | High | 2024–2025 | Official Anthropic course |
| 2 | [Lesson 1: Intro to evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/01_intro_to_evals/01_intro_to_evals.ipynb) | High | 2024–2025 | Official Anthropic course |
| 3 | [Lesson 3: Code-graded evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/03_code_graded_evals/03_code_graded.ipynb) | High | 2024–2025 | Official Anthropic course |
| 4 | [Lesson 4: Classification evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/04_code_graded_classification_evals/04_code_graded_classification_evals.ipynb) | High | 2024–2025 | Official Anthropic course |
| 5 | [Lesson 7: Custom graders notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/07_prompt_foo_custom_graders/lesson.ipynb) | High | 2024–2025 | Official Anthropic course |
| 6 | [Lesson 8: Model-graded evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/08_prompt_foo_model_graded/lesson.ipynb) | High | 2024–2025 | Official Anthropic course |
| 7 | [Lesson 9: Custom model-graded evals notebook](https://raw.githubusercontent.com/anthropics/courses/master/prompt_evaluations/09_custom_model_graded_prompt_foo/lesson.ipynb) | High | 2024–2025 | Official Anthropic course |
| 8 | [Anthropic docs: Define success and build evaluations](https://docs.anthropic.com/en/docs/test-and-evaluate/develop-tests) | High | 2025 | Official Anthropic docs |
| 9 | [cookbook: building_evals.ipynb](https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/building_evals.ipynb) | High | 2024–2025 | Official Anthropic cookbook |
| 10 | [cookbook: generate_test_cases.ipynb](https://raw.githubusercontent.com/anthropics/anthropic-cookbook/main/misc/generate_test_cases.ipynb) | High | 2024–2025 | Official Anthropic cookbook |
| 11 | [anthropics/evals repo README](https://github.com/anthropics/evals) | High | 2022–2024 | Official Anthropic research |

---

## Knowledge Gaps

- **Agent/multi-turn eval patterns:** Anthropic's course and cookbook cover only single prompt-response evaluations. No official guidance on evaluating tool-use chains, filesystem side-effects, or multi-step agent trajectories. Suggested query: "Anthropic agent evaluation multi-turn tool use 2025"
- **Pairwise/ranking eval patterns:** The course never demonstrates pairwise comparison (A vs. B) or ranked-choice/Borda count scoring. These appear only implicitly via promptfoo's multi-prompt matrix view. Suggested query: "Anthropic pairwise comparison eval LLM judge 2025"
- **Claude Code specific evals:** No Anthropic-published material on evaluating Claude Code plugin or skill behavior. The `Claude Code Analytics API` referenced in the docs nav may have relevant tooling but the page content was not retrieved. Suggested query: "Claude Code Analytics API eval skill behavior"
- **Workbench Evaluation Tool deep-dive:** The nav references "Using the Evaluation Tool" as a separate docs page, but the content was hidden behind JS rendering. This tool may have more sophisticated grading options than the Workbench UI described in Lesson 2.

---

## Search Limitations

- **Model:** claude-sonnet-4-6 (native, no web search API)
- **Web search:** Unavailable as structured search; used direct HTTP fetch to known URLs
- **Local search:** Not performed (no relevant local eval files for this sub-question)
- **Date range:** Sources from 2022–2025 (course notebooks appear to be actively maintained; exact last-updated dates not always visible)
- **Rendering limitation:** Anthropic's docs site uses heavy client-side JS rendering; some pages returned only nav chrome. Raw content was retrieved from GitHub notebook files directly, which gave better fidelity.
- **Notebook images:** Course notebooks contain many inline images (eval dashboards, screenshots of promptfoo UI) that are attachment-encoded and not visible in raw JSON form. Textual descriptions in the notebooks sufficed for the research goals.

---

## Relevance to Our Use Case

Our context: Claude Code plugin ecosystem with 12 plugins and ~47 skills. Existing tech-writer-eval uses a 7-model LLM-as-judge panel with Borda count scoring.

### What Anthropic's approach validates about our current design

1. **LLM-as-judge is endorsed.** Anthropic explicitly recommends model-graded evals for "subjective and context-dependent" criteria. Our 7-model panel is more sophisticated than Anthropic's single-judge pattern (they typically use Claude 3 Opus as the single grader). Our multi-judge approach is likely more robust to individual judge bias.

2. **Structured output extraction from judge is correct.** We should ensure our judge prompts use XML tags (e.g., `<score>`, `<reasoning>`) and that we parse only the structured output, discarding the chain-of-thought. This is Anthropic's canonical pattern.

3. **Rubrics with anchor descriptions are the right format.** Anthropic's Lesson 9 demonstrates that 1-5 Likert scales work well when each scale point has a concrete description ("Conciseness of 1: unnecessarily long... Conciseness of 5: perfectly condenses"). We should ensure our judge rubrics have explicit per-level anchors, not just a numeric scale.

### What Anthropic's approach suggests we should add or change

4. **Chain-of-thought before verdict.** Anthropic shows that asking the judge to `<thinking>` before outputting its `<score>` improves accuracy on complex tasks. If our current judge prompts go straight to scoring, adding a reasoning step could improve judge reliability — especially for nuanced skill quality assessments.

5. **100+ test cases target.** We need to build toward 100+ skill-specific test cases per skill category. Anthropic's course emphasizes this floor repeatedly. Currently our tech-writer-eval has 4 candidate documents (effectively 4 test cases) — far below the minimum for statistical confidence.

6. **Synthetic test case generation.** The `generate_test_cases.ipynb` pattern (using Claude to generate realistic input variations from a prompt template) is directly applicable to generating diverse skill invocation inputs. We can template a skill's intended behavior and have Claude generate 50-100 realistic invocation scenarios.

7. **Use promptfoo for the prompt-level layer.** Promptfoo's `get_assert()` Python hook is flexible enough to wrap our CLI invocations (`claudish` / `claude -p`) as a custom provider. For single-turn skill outputs, promptfoo's YAML-driven test matrix (multiple prompts × multiple models × multiple test cases) would accelerate coverage. The custom Python grader path allows us to preserve our existing Borda count or panel aggregation logic.

8. **Agentic eval patterns need external references.** Anthropic's official course does not cover evaluating multi-step agent behavior, tool-use chains, or filesystem side-effects. For our skill eval harness (which must verify that a skill correctly orchestrates tool calls, writes files, invokes sub-agents, etc.), we need to look beyond Anthropic's curriculum — likely to Inspect AI, OpenAI Evals format, or custom harness design based on our existing `execute-test.sh` + `aggregator.ts` infrastructure.

### Specific actionable patterns

| Anthropic Pattern | Application to Our Skills Eval |
|-------------------|-------------------------------|
| XML-tagged judge output (`<correctness>`) | Standardize all judge prompts to use `<score>N</score><reasoning>...</reasoning>` |
| CoT before verdict | Add `<thinking>` step to judge prompts; discard before aggregation |
| Rubric with per-level anchors | Define 1-5 anchor text for each skill quality dimension (correctness, tool use, output format, user helpfulness) |
| 100+ test case minimum | Build skill-specific scenario datasets; use Claude to generate synthetic inputs |
| `get_assert()` Python hook | Wrap `claudish` as promptfoo provider; implement panel aggregation in `get_assert()` |
| Multi-prompt comparison matrix | Use promptfoo to compare skill prompt v1 vs v2 across all test cases at once |
| Code-graded when possible | For skills with structured outputs (JSON, file paths, diffs), prefer regex/JSON-schema grading over LLM-judge |
