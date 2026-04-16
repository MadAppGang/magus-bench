# Magus Bench

Benchmarks and autonomous experiment platform for the Magus plugin ecosystem.

## Project structure

```
magus-bench/
  platform/                       # Autonomous experiment orchestrator (Bun TypeScript)
    loop.ts                       # Main entry point
    config.json                   # Active experiment + settings
    engine/                       # Generic engine (never benchmark-specific)
      types.ts                    # Experiment interface, Metrics, Hypothesis
      plugin-registry.ts          # Loads experiment plugins
      hypothesis.ts               # Hypothesis tracking (append-only JSONL)
      diff-verifier.ts            # Variable isolation enforcement
      decision.ts                 # Generic keep/drop logic
      journal.ts                  # Journal entry builder
    plugins/                      # One TypeScript plugin per experiment
      tech-writer-quality/        # Doc quality via prompt/rubric iteration
      agent-routing/              # Skill/agent routing correctness
    phases/                       # 6 generic phase scripts (research → journal)
    templates/                    # Agent prompt templates with {{VAR}} placeholders
    lib/                          # Utilities: agent spawn, worktree, state
    runs/                         # Iteration outputs (gitignored)
  benchmarks/                     # Eval harnesses — each runnable standalone
    tech-writer/                  # 4-way blind doc comparison
      run.sh                      # generate → judge → analyze
      analyze-results.ts          # Bun: Borda, Friedman, bootstrap CI
      test-cases.json, prompts/, reference/, baselines/
    skill-routing/                # promptfoo skill-routing correctness
      promptfooconfig.yaml, test-cases.yaml, prompts/
  experiments/                    # Structured investigations
  poc/                            # Quick spikes and proofs of concept
  archive/                        # Completed work (preserved for reference)
    claude-md-routing-2026-03/    # Legacy manual CLAUDE.md hypothesis tests
  docs/                           # Architecture, testing, contribution guides
  ai-docs/                        # AI working files (gitignored)
```

## Runtime

- **Bun 1.3+** for all TypeScript (not Node, not ts-node)
- **bash 3.2** for shell scripts (macOS compatible, no GNU coreutils)
- **claudish** for non-Claude model API calls via OpenRouter
- **claude -p** for Claude API calls from agent templates

## Key conventions

- Experiment plugins implement the `Experiment` interface from `platform/engine/types.ts`
- Adding a new experiment plugin: write `platform/plugins/<name>/experiment.ts`, register in `plugin-registry.ts`, set `experiment_id` in `platform/config.json`
- Adding a new benchmark: create `benchmarks/<name>/` with a `run.sh` entry point and (optionally) a plugin under `platform/plugins/` that wraps it
- Adding a PoC: drop it in `poc/<name>/` with a README. Graduates to `benchmarks/` if it proves out, or to `archive/` if wound down
- Adding an experiment: create `experiments/<name>-YYYY-MM/` with a README stating the question, methodology, and (once done) findings
- Phase scripts communicate only through the filesystem (`platform/runs/iteration-N/<phase>/`)
- Each phase checks sentinel files for idempotency (skip if output exists)
- Decision logic (keep/drop) is deterministic TypeScript in plugins, not LLM reasoning
- Git worktrees at `/tmp/magus-bench-loop/` for isolation
- Hypothesis tracking in `platform/hypotheses.jsonl` (append-only)

## Running the experiment loop

```bash
bun platform/loop.ts --runs 5           # run 5 iterations
bun platform/loop.ts --runs 1 --dry-run # dry-run (no API calls)
bun platform/loop.ts                    # infinite (stop: touch platform/STOP)
```

## Running benchmarks directly

```bash
cd benchmarks/tech-writer && ./run.sh                                   # tech-writer
npx promptfoo eval -c benchmarks/skill-routing/promptfooconfig.yaml    # skill-routing
```

## Session directories

Architecture and research artifacts go in `ai-docs/sessions/{task-slug}-{timestamp}-{random}/`. These are git-ignored working directories, not permanent outputs.
