# Experiments

Structured investigations. "Which of these N approaches is best?" or "How does factor X affect outcome Y?" Have a stated methodology, collect data, produce findings. Lifetime: weeks to months.

## When to put something here

- You're comparing multiple variants with a repeatable protocol
- You want a journal of what you tried and what you learned
- The output is structured findings (numbers, tables, conclusions) rather than a single yes/no
- The work is too heavyweight for `../poc/` but too one-off to be a permanent benchmark

Example in the wild: the `archive/claude-md-routing-2026-03/` experiment started its life as exactly this kind of investigation — four CLAUDE.md variants, a methodology, per-variant results — before being archived when findings got folded into mainline code.

## When *not* to put something here

- Quick go/no-go spike → use [`../poc/`](../poc/)
- Ongoing measurement you'll run repeatedly → use [`../benchmarks/`](../benchmarks/)
- Autonomous optimization loop → write a plugin in [`../platform/plugins/`](../platform/plugins/)

## Shape

Looser than `benchmarks/` but more structured than `poc/`. Typical layout:

```
experiments/
├── judge-cost-tradeoff-2026-05/
│   ├── README.md              # Question, methodology, TL;DR findings
│   ├── RESULTS.md             # Full write-up
│   ├── run-experiment.sh      # Reproducible harness (may call benchmarks/)
│   ├── arms/                  # One dir per variant being tested
│   │   ├── baseline/
│   │   ├── variant-a/
│   │   └── variant-b/
│   └── journal/               # Per-iteration logs if iterative
│       └── session-YYYYMMDD.md
```

Date suffixes are encouraged — experiments are intrinsically temporal (what was true in May 2026 may not be in October).

## Lifecycle

1. **Active.** Experiment is running, results accumulating in-place.
2. **Published.** Findings are written up in `RESULTS.md`; anything that should outlive the experiment (benchmarks, code changes, doc updates) is extracted.
3. **Archived.** The whole directory moves to `../archive/<name>/` once findings are folded back. Keep the `README.md` findings-first so a future reader can see conclusions without reading the full write-up.

## Relationship to `platform/`

An experiment can drive the `platform/` orchestrator as one arm (e.g., "run 5 iterations with config A, 5 with config B, compare"). In that case, the experiment's `run-experiment.sh` invokes `bun platform/loop.ts` with different `--experiment` IDs. The experiment owns the comparison; the platform owns the optimization loop inside each arm.
