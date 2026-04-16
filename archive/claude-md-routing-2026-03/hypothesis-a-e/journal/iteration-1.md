# Experiment Journal: Hypothesis A+E (Structural Separation + Trigger Examples)

**Iteration**: 1
**Date**: 2026-03-18
**Hypothesis**: E — Concrete trigger examples added to agent entries (layered on top of Hypothesis A)
**Status**: FAIL

---

## Abstract

Hypothesis A+E tested whether adding 2-3 concrete trigger examples per agent entry (e.g., "Research best practices for X", "Why is this test failing?") would improve routing accuracy beyond the structural AGENTS/SKILLS separation already achieved by Hypothesis A alone. After correcting for a transcript parser bug that masked Agent tool calls, both variants scored identically: 8/10 (80%) agent delegation, 12/12 (100%) skill routing, 20/22 (91%) overall. The trigger examples provided zero incremental value because the structural separation and prohibition language in Hypothesis A were already sufficient to resolve the routing ambiguities the examples targeted.

---

## 1. Hypothesis

### Statement
Adding concrete trigger examples (2-3 per agent) to the AGENTS table would improve routing accuracy by helping the model match incoming requests to the correct agent through pattern recognition, building on top of the structural separation from Hypothesis A.

### Rationale
The 7-model consensus ranked Hypothesis E as the #2 improvement (6/7 models), with an estimated +16pp impact additive to Hypothesis A. Models predicted that explicit examples like "Research best practices for X" and "Debug this error: TypeError..." would reduce ambiguity between overlapping agents (e.g., `code-analysis:detective` vs `dev:debugger`). See `ai-docs/sessions/dev-arch-20260318-125504-7f2a2d29/consensus.md`.

### Expected Impact
+16pp agent delegation above Hypothesis A alone (from ~80% to ~96%), per consensus estimate of +16pp additive impact.

---

## 2. Experiment Setup

### Independent Variable
An "Example triggers" column added to the AGENTS table in CLAUDE.md, providing 2-3 concrete trigger phrases per agent entry. For example:
- `dev:researcher`: "Research best practices for X", "Compare libraries for Y", "What are the latest patterns for Z?"
- `dev:debugger`: "Why is this test failing?", "Debug this error: TypeError...", "Find the root cause of the 500 error"
- `code-analysis:detective`: "How does authentication work in this app?", "Find all API endpoints", "Trace the data flow for X"

### Control
Hypothesis A CLAUDE.md (separate AGENTS/SKILLS sections with prohibition language, but no trigger examples column). Same test suite, same model, same infrastructure.

### Test Configuration

| Parameter | Value |
|-----------|-------|
| Test suite | routing-synthetic |
| Model | internal (Claude) |
| Test cases | 22 total (10 agent delegation, 12 skill routing) |
| Parallel workers | 5 |
| Timeout per case | default |
| Run ID | run-20260318-142948 |

### Changes Made
Compared to Hypothesis A (`experiments/hypothesis-a/CLAUDE.md`):
- Added an "Example triggers" column to the AGENTS table with 2-3 example phrases per agent
- No other changes (SKILLS section, prohibition language, structure all identical)

Compared to Baseline (`experiments/baseline/CLAUDE.md`):
- Separated single "Task Routing" table into distinct AGENTS and SKILLS sections (from Hypothesis A)
- Added "Do NOT use for" column per agent (from Hypothesis A)
- Added "Do NOT handle inline" prohibition language (from Hypothesis A)
- Added "NEVER use Task tool for skills" instruction (from Hypothesis A)
- Added "Example triggers" column with concrete trigger phrases (Hypothesis E addition)

---

## 3. Results

### Data Quality Check

The raw results-summary.json shows 7 "errors" (NO_DELEGATION) for agent delegation cases. This is a known transcript parser bug: the parser checked for `block.name === "Task"` but Claude Code uses `"Agent"` as the tool name, causing all Agent tool calls to appear invisible. The corrected results below account for this bug, as documented in `experiments/RESULTS.md`.

### Summary (Corrected)

| Metric | Baseline | Hypothesis A | Hypothesis A+E | Delta (A+E vs A) |
|--------|----------|-------------|----------------|-------------------|
| Agent delegation | 5/10 (50%) | 8/10 (80%) | 8/10 (80%) | +0pp |
| Skill routing | 12/12 (100%) | 12/12 (100%) | 12/12 (100%) | +0pp |
| Overall | 17/22 (77%) | 20/22 (91%) | 20/22 (91%) | +0pp |

### Agent Delegation Breakdown (Corrected)

| Test Case | Expected | Actual | Result | Duration |
|-----------|----------|--------|--------|----------|
| `delegate-debug-01-var-01` | dev:debugger | dev:debugger | PASS | 176s |
| `delegate-debug-01-var-02` | dev:debugger | dev:debugger | PASS | 179s |
| `delegate-investigate-01-var-01` | code-analysis:detective | code-analysis:claudemem-search | FAIL | 279s |
| `delegate-investigate-01-var-02` | code-analysis:detective | code-analysis:detective | PASS | 220s |
| `delegate-research-01-var-01` | dev:researcher | dev:researcher | PASS | 1267s |
| `delegate-research-01-var-02` | dev:researcher | dev:researcher | PASS | 435s |
| `direct-simple-01-var-01` | NO_TASK_CALL | code-analysis:claudemem-search | FAIL | 50s |
| `direct-simple-01-var-02` | NO_TASK_CALL | code-analysis:claudemem-search | FAIL | 49s |
| `explicit-researcher-01-var-01` | dev:researcher | dev:researcher | PASS | 152s |
| `explicit-researcher-01-var-02` | dev:researcher | dev:researcher | PASS | 913s |

Note: The raw JSON shows `NO_DELEGATION` / `NO_TASK_CALL` for many cases due to the parser bug. The corrected results above reflect what actually happened based on the RESULTS.md correction and the parser fix (`block.name === "Agent"` recognition).

### Skill Routing Breakdown

| Test Case | Result | Duration |
|-----------|--------|----------|
| `skill-claudemem-explicit-01-var-01` | PASS | 64s |
| `skill-claudemem-explicit-01-var-02` | PASS | 61s |
| `skill-claudemem-implicit-01-var-01` | PASS | 86s |
| `skill-claudemem-implicit-01-var-02` | PASS | 85s |
| `skill-not-agent-01-var-01` | PASS | 140s |
| `skill-not-agent-01-var-02` | PASS | 74s |
| `skill-routing-detective-01-var-01` | PASS | 274s |
| `skill-routing-detective-01-var-02` | PASS | 271s |
| `skill-simple-no-skill-01-var-01` | PASS | 55s |
| `skill-simple-no-skill-01-var-02` | PASS | 50s |
| `skill-spelling-bash-01-var-01` | PASS | 62s |
| `skill-spelling-bash-01-var-02` | PASS | 63s |

### Failure Analysis

- **`delegate-investigate-01-var-01`**: Routed to `code-analysis:claudemem-search` instead of `code-analysis:detective`. The `claudemem-search` skill description in the system prompt is aggressively worded ("PRIMARY TOOL for semantic code search"), which pulls investigation tasks toward it even when the `detective` agent is the correct target. Trigger examples did not help disambiguate because both the skill and the agent operate in the "investigation" semantic space.

- **`direct-simple-01-var-01`** and **`direct-simple-01-var-02`**: Over-delegation. These are simple file-read tasks (e.g., "Show me the version from plugins/dev/plugin.json") that should be handled inline, but Claude delegated to `code-analysis:claudemem-search`. The trigger examples added in Hypothesis E did not address over-delegation because examples only show WHEN to delegate, not when NOT to. The prohibition language ("Do NOT handle inline") works in one direction only.

---

## 4. Comparison to Previous Iterations

| Metric | Baseline | Hypothesis A | Hypothesis A+E (this) |
|--------|----------|-------------|----------------------|
| Agent delegation | 50% | 80% | 80% |
| Skill routing | 100% | 100% | 100% |
| Overall | 77% | 91% | 91% |

Hypothesis A delivered a +30pp improvement in agent delegation over baseline. Hypothesis E added +0pp on top of A. The combined A+E treatment is identical to A alone.

---

## 5. Observations

1. **Trigger examples are redundant when structural separation is clear.** The AGENTS/SKILLS split with prohibition columns already provides enough signal for the model to route correctly. Adding examples repeats information the model can infer from the "Use for" and "Do NOT use for" columns.

2. **The 80% ceiling is caused by over-delegation, not under-delegation.** Both `direct-simple` variants failed because Claude delegated a trivial file-read task. The remaining failures are not about failing to recognize delegation triggers -- they are about failing to recognize when NOT to delegate. Trigger examples inherently cannot address this.

3. **The `claudemem-search` skill is an over-delegation attractor.** In both A and A+E, `delegate-investigate-01-var-01` was mis-routed to `claudemem-search`. This skill's aggressive system prompt description ("PRIMARY TOOL for semantic code search") creates a gravity well that pulls investigation tasks away from the correct `detective` agent. This is a system prompt issue, not a CLAUDE.md issue.

4. **Variance between var-01 and var-02 of investigation cases is consistent.** In Hypothesis A, `delegate-investigate-01-var-01` passed while var-02 failed. In A+E, the pattern flipped (var-01 failed, var-02 passed). This suggests the investigation-vs-search routing boundary is noisy regardless of trigger examples.

5. **Skill routing remains perfect at 100%.** The SKILLS section structure is robust across both A and A+E. The "NEVER use Task tool for skills" instruction is sufficient.

---

## 6. Conclusions

### Hypothesis Verdict: REFUTED

Hypothesis E (concrete trigger examples) provided zero incremental improvement over Hypothesis A alone. Both scored identically at 8/10 (80%) agent delegation and 20/22 (91%) overall. The 7-model consensus predicted +16pp additive impact; the actual measured impact was +0pp. The structural separation and prohibition language from Hypothesis A are sufficient -- the model does not need worked examples to match requests to agents.

### Key Findings
1. Structural separation (AGENTS vs SKILLS sections + prohibition columns) accounts for the entire +30pp improvement. Trigger examples add no measurable value.
2. The remaining 20% failure rate is caused by over-delegation (delegating simple tasks), not by mis-routing or under-delegation. This failure mode cannot be addressed by adding more positive examples.
3. The `claudemem-search` skill's aggressive system prompt description is the root cause of the investigation mis-routing, which is outside CLAUDE.md's control.

### Implications for Next Iteration
1. **Do not pursue further example-based enrichments.** The signal-to-noise ratio of CLAUDE.md routing instructions has diminishing returns beyond structural separation.
2. **Focus on over-delegation prevention.** Add explicit "handle inline if: single file read, trivial lookup, direct path provided" guardrails.
3. **Investigate `claudemem-search` skill description.** Toning down the "PRIMARY TOOL" language may reduce the attractor effect that causes investigation mis-routing.
4. **Apply Hypothesis A (not A+E) to production.** Since E adds no value, use the simpler A variant to minimize CLAUDE.md token overhead.

---

## 7. Artifacts & References

| Artifact | Path |
|----------|------|
| Experiment CLAUDE.md | `experiments/hypothesis-a-e/CLAUDE.md` |
| Hypothesis A CLAUDE.md | `experiments/hypothesis-a/CLAUDE.md` |
| Baseline CLAUDE.md | `experiments/baseline/CLAUDE.md` |
| A+E Results summary | `experiments/hypothesis-a-e/results-summary.json` |
| A Results summary | `experiments/hypothesis-a/results-summary.json` |
| A+E Run config | `experiments/hypothesis-a-e/run-config.json` |
| A Run config | `experiments/hypothesis-a/run-config.json` |
| A+E Full run log | `experiments/hypothesis-a-e/last-run.log` |
| Combined results | `experiments/RESULTS.md` |
| Architecture session | `ai-docs/sessions/dev-arch-20260318-125504-7f2a2d29/` |
| Consensus document | `ai-docs/sessions/dev-arch-20260318-125504-7f2a2d29/consensus.md` |
| Autotest results (A+E) | `routing-synthetic/results/run-20260318-142948/` |
| Autotest results (A) | `routing-synthetic/results/run-20260318-140933/` |
| Autotest results (baseline) | `routing-synthetic/results/run-20260318-011417/` |

---

## Appendix: Raw Data

### Hypothesis A+E Results (`experiments/hypothesis-a-e/results-summary.json`)
```json
{
  "runs": [
    {"test_id": "delegate-debug-01-var-01", "result": "NO_DELEGATION", "expected_agent": "dev:debugger", "actual_agent": "NO_TASK_CALL", "duration_seconds": 176},
    {"test_id": "delegate-debug-01-var-02", "result": "NO_DELEGATION", "expected_agent": "dev:debugger", "actual_agent": "NO_TASK_CALL", "duration_seconds": 179},
    {"test_id": "delegate-investigate-01-var-01", "result": "FAIL", "expected_agent": "code-analysis:detective", "actual_agent": "code-analysis:claudemem-search", "duration_seconds": 279},
    {"test_id": "delegate-investigate-01-var-02", "result": "NO_DELEGATION", "expected_agent": "code-analysis:detective", "actual_agent": "NO_TASK_CALL", "duration_seconds": 220},
    {"test_id": "delegate-research-01-var-01", "result": "NO_DELEGATION", "expected_agent": "dev:researcher", "actual_agent": "NO_TASK_CALL", "duration_seconds": 1267},
    {"test_id": "delegate-research-01-var-02", "result": "NO_DELEGATION", "expected_agent": "dev:researcher", "actual_agent": "NO_TASK_CALL", "duration_seconds": 435},
    {"test_id": "direct-simple-01-var-01", "result": "FAIL_OVER_DELEGATED", "expected_agent": "NO_TASK_CALL", "actual_agent": "code-analysis:claudemem-search", "duration_seconds": 50},
    {"test_id": "direct-simple-01-var-02", "result": "FAIL_OVER_DELEGATED", "expected_agent": "NO_TASK_CALL", "actual_agent": "code-analysis:claudemem-search", "duration_seconds": 49},
    {"test_id": "explicit-researcher-01-var-01", "result": "NO_DELEGATION", "expected_agent": "dev:researcher", "actual_agent": "NO_TASK_CALL", "duration_seconds": 152},
    {"test_id": "explicit-researcher-01-var-02", "result": "NO_DELEGATION", "expected_agent": "dev:researcher", "actual_agent": "NO_TASK_CALL", "duration_seconds": 913},
    {"test_id": "skill-claudemem-explicit-01-var-01", "result": "PASS", "duration_seconds": 64},
    {"test_id": "skill-claudemem-explicit-01-var-02", "result": "PASS", "duration_seconds": 61},
    {"test_id": "skill-claudemem-implicit-01-var-01", "result": "PASS", "duration_seconds": 86},
    {"test_id": "skill-claudemem-implicit-01-var-02", "result": "PASS", "duration_seconds": 85},
    {"test_id": "skill-not-agent-01-var-01", "result": "PASS", "duration_seconds": 140},
    {"test_id": "skill-not-agent-01-var-02", "result": "PASS", "duration_seconds": 74},
    {"test_id": "skill-routing-detective-01-var-01", "result": "PASS", "duration_seconds": 274},
    {"test_id": "skill-routing-detective-01-var-02", "result": "PASS", "duration_seconds": 271},
    {"test_id": "skill-simple-no-skill-01-var-01", "result": "PASS", "duration_seconds": 55},
    {"test_id": "skill-simple-no-skill-01-var-02", "result": "PASS", "duration_seconds": 50},
    {"test_id": "skill-spelling-bash-01-var-01", "result": "PASS", "duration_seconds": 62},
    {"test_id": "skill-spelling-bash-01-var-02", "result": "PASS", "duration_seconds": 63}
  ],
  "summary": {
    "total": 22,
    "passed": 12,
    "failed": 3,
    "errors": 7,
    "pass_rate": 54.5,
    "agent_distribution": {"NO_TASK_CALL": 12, "code-analysis:claudemem-search": 9, "dev:architect": 1}
  },
  "suite": "routing-synthetic",
  "models": ["internal"]
}
```

**Note**: Raw pass_rate of 54.5% is artificially low due to the transcript parser bug (Agent tool name not recognized). Corrected pass rate after parser fix: 91% (20/22).
