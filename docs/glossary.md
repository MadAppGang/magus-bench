# Glossary

Terms used throughout the repo. The words "benchmark," "experiment," "eval," and "harness" get used interchangeably in the wild — in this repo they mean specific things.

## The four kinds of work in this repo

| Kind | Where | Rigor | Lifetime | Graduates to |
|---|---|---|---|---|
| **PoC** | `poc/<name>/` | Loose — any shape | Days–weeks | `benchmarks/` or `archive/` |
| **Experiment** | `experiments/<name>-YYYY-MM/` | Methodology + structured findings | Weeks–months | `archive/` (with findings folded back) |
| **Benchmark** | `benchmarks/<name>/` | Stable schema + baselines + reproducible | Permanent | — |
| **Experiment plugin** | `platform/plugins/<name>/` | Implements `Experiment` interface | Permanent | — |

## benchmark

A self-contained measurement instrument in `benchmarks/<name>/`. Each benchmark:

- Has its own entry point (`run.sh`, `promptfooconfig.yaml`, etc.)
- Runs standalone without the platform (`cd benchmarks/tech-writer && ./run.sh`)
- Produces a structured output (JSON, typically) that defines its metrics
- Owns its baselines, results, and prompts

Current benchmarks: `tech-writer`, `skill-routing`.

## experiment

The word "experiment" means different things depending on context:

1. **An investigation** (`experiments/<name>/`): A structured multi-arm comparison with methodology and findings. Lives in `experiments/`. Temporal — date-suffixed names encouraged. Findings get folded back into code/docs; the experiment itself archives. See [`../experiments/README.md`](../experiments/README.md).

2. **An experiment plugin** (`platform/plugins/<name>/experiment.ts`): A TypeScript file that wraps a benchmark for autonomous optimization by the platform. Implements the `Experiment` interface from `platform/engine/types.ts`. Current plugins: `tech-writer-quality`, `agent-routing`.

Context usually makes the meaning clear: "run an experiment" = #1; "write an experiment plugin" = #2.

## PoC (proof of concept)

A quick spike in `poc/<name>/`. One-off test to answer a single narrow question fast. No required structure beyond a README. Often thrown away or graduated to a benchmark or experiment. See [`../poc/README.md`](../poc/README.md).

## eval (or "eval harness")

Informal synonym for **benchmark**. Used in older docs. Prefer "benchmark" for new writing.

## harness

Historically meant "benchmark" (see the empty `harnesses/` directory at the old repo root before reorganization). Now superseded by `benchmarks/`. Don't use this term in new writing unless quoting legacy code or commit history.

## platform

The autonomous experiment orchestrator (`platform/`). It runs experiments in a closed loop: propose hypotheses → implement in parallel worktrees → measure → decide → journal. Previously named "loop."

## plugin

In this repo, "plugin" always means an **experiment plugin** (a file in `platform/plugins/<name>/experiment.ts`). This is distinct from the Claude Code / Magus plugins being *tested* — those are the subject matter, not the code here. Context usually disambiguates which meaning is in play.

## run

One complete execution of a benchmark. Produces a timestamped directory (e.g., `benchmarks/tech-writer/results/run-20260415-120000/`).

## iteration

One complete cycle of the platform through all six phases (research → plan → execute → analyze → decide → journal). Produces a timestamped directory at `platform/runs/iteration-N/`. An iteration typically spawns 3 parallel *runs* of the underlying benchmark (one per candidate approach).

## approach

A single candidate variant within an iteration. Each iteration compares 3 approaches (labeled `a`, `b`, `c`) in separate git worktrees against the current baseline. The reviewer agent votes on each, and the decision phase applies the plugin's `isImprovement` / `isRegression` logic to decide which approaches to merge.

## baseline

The current best result for a benchmark, stored on disk as JSON. New approaches are compared against the baseline; only approaches that beat it get merged and replace it. Benchmark-specific — `tech-writer` stores `baselines/latest/scores.json`; `skill-routing` stores `results/latest.json`.

## hypothesis

A research agent's proposed change, persisted as an append-only JSONL entry in `platform/hypotheses.jsonl`. Each hypothesis moves through states: `created` → `accepted` (merged) or `rejected` (dropped).

## journal

The append-only human-readable log of platform iterations at `platform/journal.md`. One entry per iteration, containing the hypotheses tested, approaches tried, metrics observed, and final decision.

## sentinel

A filesystem marker used by the platform for idempotency and control:

- `platform/runs/iteration-N/research/agent-c-brief.md` — research phase complete
- `platform/LOCK` — another platform process is running
- `platform/STOP` — request clean shutdown after current phase
- `platform/STALLED` — N consecutive iterations produced no improvement; platform halted
