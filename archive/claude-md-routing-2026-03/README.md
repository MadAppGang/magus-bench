# CLAUDE.md routing experiments (March 2026)

**Status:** archived. This was a manual hypothesis-testing round conducted before the autonomous `platform/` orchestrator existed.

## What this was

A four-way comparison of CLAUDE.md variants to measure their effect on Claude Code's agent-delegation and skill-routing correctness. The variants ("baseline," "hypothesis-a," "hypothesis-a-e," "hypothesis-a-e-b") tested progressively stronger structural separation of AGENTS vs SKILLS sections, explicit prohibition language, and trigger examples.

## What it found

Hypothesis A alone moved agent-delegation rate from 50% to 80% — documented in [`RESULTS.md`](./RESULTS.md). Hypothesis E (trigger examples) did not improve beyond that ceiling.

A critical parser bug was also discovered: the transcript evaluator was checking `block.name === "Task"` but Claude Code uses `"Agent"` as the tool name, making all Agent delegations invisible. See RESULTS.md for the one-line fix.

## Why it's archived

- The *methodology* — run each variant against autotest, compare delegation rates — has been superseded by `benchmarks/skill-routing/` which does the same measurement faster with promptfoo + structured assertions.
- The *findings* were folded back into the main CLAUDE.md.
- The *scripts* here (`run-experiment.sh`) still work but require the sibling `../../claude-code` repo at a specific location; they're preserved for reproducibility, not active use.

## Running (if you really want to)

```bash
./run-experiment.sh baseline
./run-experiment.sh hypothesis-a --parallel 3
```

The script backs up the current CLAUDE.md in the sibling `claude-code` repo, copies the variant CLAUDE.md in, runs autotest's routing-synthetic suite, then restores the original. Results copy back to the variant's directory.
