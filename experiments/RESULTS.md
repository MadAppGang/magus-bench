# Experiment Results: CLAUDE.md Routing Optimization

**Date**: 2026-03-18
**Architecture session**: `ai-docs/sessions/dev-arch-20260318-125504-7f2a2d29/`

## Critical Discovery: Parser Bug

The transcript parser only checked for `block.name === "Task"` but Claude Code uses `"Agent"` as the tool name. This caused all Agent tool calls to be invisible to the evaluator, making it appear that delegation never happened.

**Fix**: `transcript-parser.ts` line 158: `block.name === "Task"` → `block.name === "Task" || block.name === "Agent"`

## Corrected Results

| Metric | Baseline | Hypothesis A | Hypothesis A+E |
|--------|----------|-------------|----------------|
| Agent delegation | 5/10 (50%) | **8/10 (80%)** | **8/10 (80%)** |
| Skill routing | 12/12 (100%) | 12/12 (100%) | 12/12 (100%) |
| Overall | 17/22 (77%) | **20/22 (91%)** | **20/22 (91%)** |

## Analysis

### Hypothesis A: +30pp agent delegation (50% → 80%)
- Separating AGENTS and SKILLS into distinct sections with prohibition language works
- "Do NOT handle inline" + "Do NOT use for" columns prevent the worst failure modes
- **Matches the 7-model consensus prediction** (avg: +29pp)

### Hypothesis E: +0pp additional
- Trigger examples did not improve beyond what A already achieved
- The 80% ceiling appears to be a different bottleneck (over-delegation)

### Remaining Failures (2/10)
Both are `direct-simple` cases where Claude OVER-delegates:
- "Show me the version from plugins/dev/plugin.json" → delegates to claudemem-search
- These are tasks Claude should handle inline, not delegate

### Over-Delegation Pattern
The `code-analysis:claudemem-search` skill description in the system prompt is very aggressive ("PRIMARY TOOL for semantic code search"). It triggers even for simple file-read tasks, causing over-delegation when the task is trivial.

## Runs
- Baseline: `routing-synthetic/results/run-20260318-011417/`
- Hypothesis A: `routing-synthetic/results/run-20260318-140933/`
- Hypothesis A+E: `routing-synthetic/results/run-20260318-142948/`

## Recommendation
1. Apply Hypothesis A to production CLAUDE.md (the separate AGENTS/SKILLS structure)
2. Fix the transcript parser (Agent tool name)
3. Investigate over-delegation from claudemem-search skill descriptions
