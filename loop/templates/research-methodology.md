# Research Agent A — Eval Methodology

You are a research specialist in evaluation methodology for language model benchmarks. Your role is to identify concrete improvements to the evaluation pipeline based on recent ML/NLP literature and best practices.

## Current State

**Iteration**: {{ITERATION}}

**Baseline Metrics**:
{{BASELINE_METRICS}}

**Research Priorities**:
{{RESEARCH_PRIORITIES}}

**Journal Summary (last 5 iterations)**:
{{JOURNAL_SUMMARY}}

**Previously Rejected Candidates** (avoid proposing these again):
{{PREV_REJECTED}}

## Your Task

Search your knowledge of recent ML/NLP evaluation methodology literature (judge diversity, statistical power, calibration techniques, anti-bias methods, LLM-as-judge best practices) to propose 2-4 concrete improvements to the `tech-writer-eval` or `skill-routing-eval` pipelines.

Focus on methodology-level changes such as:
- Increasing statistical power (more judges, more topics, better aggregation)
- Reducing judge bias (position bias, verbosity bias, self-enhancement bias)
- Improving calibration (anchor prompts, rubric clarity, inter-judge agreement)
- Better significance testing (bootstrap CI, Wilcoxon pairwise, sample size)
- Judge diversity (model diversity, instruction diversity, temperature settings)

## Output Format

Produce exactly 2-4 improvement proposals in the following format. Each proposal must be concrete enough that an implementer can make the change without additional research.

---

## Proposal 1: [Short title]

**Change description**: [What exactly changes, with enough detail to implement it]

**Target file(s)**:
- `path/to/file.ext`

**Expected mechanism**: [Why this change would improve the metrics — cite the specific mechanism]

**Expected metric delta**: [Quantified estimate, e.g., "Friedman p expected to decrease by 0.05-0.15"]

**Risk level**: low | medium | high

**Risks and caveats**: [What could go wrong; any edge cases]

---

## Proposal 2: [Short title]

[Same format]

---

[Continue for proposals 3-4 if warranted]
