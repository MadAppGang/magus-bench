# Magus Bench

Benchmarks and autonomous experiment platform for the Magus plugin ecosystem.

## Project structure

```
magus-bench/
  loop/                           # Experiment platform (Bun TypeScript)
    loop.ts                       # Main orchestrator
    config.json                   # Active experiment + settings
    engine/                       # Generic engine (never experiment-specific)
      types.ts                    # Experiment interface, Metrics, Hypothesis
      plugin-registry.ts          # Loads experiment plugins
      hypothesis.ts               # Hypothesis tracking (append-only JSONL)
      diff-verifier.ts            # Variable isolation enforcement
      decision.ts                 # Generic keep/drop logic
      journal.ts                  # Journal entry builder
    experiments/                  # One TypeScript plugin per experiment
      tech-writer-quality/        # Doc quality improvement via prompt/rubric iteration
      agent-routing/              # Skill/agent routing correctness
    phases/                       # 6 generic phase scripts (research → journal)
    templates/                    # Agent prompt templates with {{VAR}} placeholders
    lib/                          # Utilities: agent spawn, worktree, state
  tech-writer-eval/               # Eval harness: 4-way blind doc comparison
    run.sh                        # Entry point: generate → judge → analyze
    analyze-results.ts            # Bun: Borda count, Friedman, bootstrap CI
    test-cases.json               # Topic, judges, criteria (9 criteria, 14 total weight)
    prompts/                      # Generation + judge templates
    baselines/latest/             # Regression baseline (scores.json)
  skill-routing-eval/             # Eval harness: promptfoo skill routing
    promptfooconfig.yaml          # 2 models, 22 test cases
    test-cases.yaml               # 11 routing categories
```

## Runtime

- **Bun 1.3+** for all TypeScript (not Node, not ts-node)
- **bash 3.2** for shell scripts (macOS compatible, no GNU coreutils)
- **claudish** for non-Claude model API calls via OpenRouter
- **claude -p** for Claude API calls from agent templates

## Key conventions

- Experiment plugins implement the `Experiment` interface from `loop/engine/types.ts`
- Adding a new experiment: write `loop/experiments/<name>/experiment.ts`, register in `plugin-registry.ts`, set `experiment_id` in `config.json`
- Phase scripts communicate only through the filesystem (`loop/iteration-N/<phase>/`)
- Each phase checks sentinel files for idempotency (skip if output exists)
- Decision logic (keep/drop) is deterministic TypeScript in plugins, not LLM reasoning
- Git worktrees at `/tmp/magus-bench-loop/` for isolation
- Hypothesis tracking in `loop/hypotheses.jsonl` (append-only)

## Running the experiment loop

```bash
bun loop/loop.ts --runs 5           # run 5 iterations
bun loop/loop.ts --runs 1 --dry-run # dry-run (no API calls)
bun loop/loop.ts                    # infinite (stop: touch loop/STOP)
```

## Running evals directly

```bash
cd tech-writer-eval && ./run.sh                                              # tech-writer
npx promptfoo eval -c skill-routing-eval/promptfooconfig.yaml                # skill-routing
```

## Session directories

Architecture and research artifacts go in `ai-docs/sessions/{task-slug}-{timestamp}-{random}/`. These are git-ignored working directories, not permanent outputs.
