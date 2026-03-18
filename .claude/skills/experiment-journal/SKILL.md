---
name: experiment-journal
description: "Write a structured experiment journal article after completing an experiment iteration. Use this skill whenever the user finishes running an experiment, wants to document results, says 'write journal', 'document this experiment', 'save experiment results', 'write up the iteration', or after any experiment run completes. Also trigger when the user asks to compare experiment iterations, summarize findings, or create a report from autotest results."
---

# Experiment Journal Writer

Generate a comprehensive, publication-quality experiment journal entry after each iteration of hypothesis testing. The journal captures everything needed to reproduce, understand, and build upon the experiment.

## When to Write a Journal

Write a journal entry after:
- An experiment run completes (autotest results available)
- The user asks to document or summarize an experiment
- Comparing multiple experiment iterations
- Concluding a hypothesis testing session

## Data Discovery

Before writing, gather all available data. Check these locations in order:

### 1. Experiment Directory (`experiments/<name>/`)
```
experiments/<name>/
├── CLAUDE.md              # The variant being tested
├── results-summary.json   # Autotest results (per-case pass/fail)
├── run-config.json        # Test configuration (cases, parallel, model)
├── last-run.log           # Full run output
```

### 2. Baseline Directory (`experiments/baseline/`)
Same structure — the control group. Always compare against this.

### 3. Architecture Session (`ai-docs/sessions/dev-arch-*/`)
```
ai-docs/sessions/dev-arch-*/
├── consensus.md           # Multi-model vote synthesis
├── hypothesis-prompt.md   # Original hypothesis definitions
├── implementation-plan.md # Planned changes
├── vote-*.md              # Individual model votes
```

### 4. Previous Journals (`experiments/<name>/journal/`)
Check if prior iteration journals exist for delta comparison.

### 5. Run Results in Target Repo
The autotest results directory (path in run-config.json or last-run.log) contains per-case transcript files for deep analysis.

## Journal Structure

Save the journal to: `experiments/<experiment-name>/journal/iteration-<N>.md`

Create the `journal/` subdirectory if it doesn't exist. Determine iteration number from existing journal files (start at 1).

Use this template — every section is required. The tables use standard markdown which renders well in terminal viewers and GitHub.

```markdown
# Experiment Journal: <Experiment Name>

**Iteration**: <N>
**Date**: <YYYY-MM-DD>
**Hypothesis**: <letter and short name>
**Status**: <PASS / PARTIAL / FAIL / INCONCLUSIVE>

---

## Abstract

<2-3 sentence summary: what was tested, what happened, what it means>

---

## 1. Hypothesis

### Statement
<What we predicted would happen and why>

### Rationale
<Why we believed this — cite research findings, model votes, prior iterations>

### Expected Impact
<Quantitative prediction — e.g., "+29pp agent delegation (from 50% to ~80%)">

---

## 2. Experiment Setup

### Independent Variable
<What changed — the specific CLAUDE.md modification>

### Control
<What stayed the same — baseline CLAUDE.md, same test cases, same model>

### Test Configuration

| Parameter | Value |
|-----------|-------|
| Test suite | <suite name> |
| Model | <model used> |
| Test cases | <N total (N agent, N skill)> |
| Parallel workers | <N> |
| Timeout per case | <N>s |
| Run ID | <run-YYYYMMDD-HHMMSS> |

### Changes Made
<Bullet list or diff summary of what specifically changed in the variant vs baseline>

---

## 3. Results

### Summary

| Metric | Baseline | This Iteration | Delta |
|--------|----------|---------------|-------|
| Agent delegation | X/Y (Z%) | X/Y (Z%) | +/-Npp |
| Skill routing | X/Y (Z%) | X/Y (Z%) | +/-Npp |
| Overall | X/Y (Z%) | X/Y (Z%) | +/-Npp |

### Agent Delegation Breakdown

| Test Case | Expected | Actual | Result | Duration |
|-----------|----------|--------|--------|----------|
| <case-id> | <agent> | <agent> | PASS/FAIL | <N>s |
| ... | ... | ... | ... | ... |

### Skill Routing Breakdown

| Test Case | Result | Duration |
|-----------|--------|----------|
| <case-id> | PASS/FAIL | <N>s |
| ... | ... | ... |

### Failure Analysis

<For each failure, explain:>
- **<case-id>**: <what went wrong and why>

---

## 4. Comparison to Previous Iterations

<If this is iteration 1, compare only to baseline.>
<If iteration 2+, show progression table:>

| Metric | Baseline | Iter 1 | Iter 2 | ... | This |
|--------|----------|--------|--------|-----|------|
| Agent delegation | Z% | Z% | Z% | ... | Z% |
| Skill routing | Z% | Z% | Z% | ... | Z% |
| Overall | Z% | Z% | Z% | ... | Z% |

---

## 5. Observations

<Patterns noticed during analysis — unexpected behaviors, recurring failure modes, interesting successes. Be specific and cite test case IDs.>

---

## 6. Conclusions

### Hypothesis Verdict: <CONFIRMED / PARTIALLY CONFIRMED / REFUTED / INCONCLUSIVE>

<Explain the verdict with evidence>

### Key Findings
1. <finding>
2. <finding>
3. <finding>

### Implications for Next Iteration
<What should change next based on these results>

---

## 7. Artifacts & References

| Artifact | Path |
|----------|------|
| Experiment CLAUDE.md | `experiments/<name>/CLAUDE.md` |
| Baseline CLAUDE.md | `experiments/baseline/CLAUDE.md` |
| Results summary | `experiments/<name>/results-summary.json` |
| Run config | `experiments/<name>/run-config.json` |
| Full run log | `experiments/<name>/last-run.log` |
| Autotest results dir | `<path from run config>` |
| Architecture session | `ai-docs/sessions/<session-id>/` |
| Consensus document | `ai-docs/sessions/<session-id>/consensus.md` |

---

## Appendix: Raw Data

<Include the full results-summary.json content formatted as a code block for reproducibility>
```

## Writing Guidelines

1. **Be precise with numbers.** Always show both absolute (5/10) and percentage (50%). Round percentages to whole numbers.

2. **Tables must be terminal-friendly.** Use standard markdown tables. Keep columns narrow enough to fit in 120-char terminal width. Truncate long strings with `...` if needed.

3. **Cite everything.** Every claim should reference a specific test case ID, file path, or data point. Use backtick formatting for paths and IDs.

4. **Diff, don't repeat.** When describing changes, show what's different from baseline/previous, not the full content. Use unified diff format for CLAUDE.md changes.

5. **Failure analysis is the most valuable section.** Spend extra effort understanding WHY failures happened, not just listing them. Read transcripts if available.

6. **The abstract should stand alone.** Someone reading only the abstract should understand what was tested, whether it worked, and the magnitude of the effect.

7. **Use active voice.** "Hypothesis A improved agent delegation by 30pp" not "A 30pp improvement in agent delegation was observed."

## Handling Multiple Experiments in One Session

If the user ran multiple experiments (e.g., hypothesis-a, then hypothesis-a-e), write a separate journal for each. Then write a **session summary** at `experiments/journal/session-<date>.md` that compares all iterations side by side with a combined progression table.

## Parser Bug Discovery Pattern

If during analysis you discover that results look wrong (e.g., 0% pass rate when transcripts show correct behavior), flag this prominently. Check for parser/evaluator bugs before concluding a hypothesis failed. This happened in the real experiment — the transcript parser didn't recognize the `Agent` tool name, making it appear that delegation never happened when it actually did.

Add a section: "### Data Quality Check" under Results if any anomalies are found.
