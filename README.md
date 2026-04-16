# Magus Bench

Benchmarks and an autonomous experiment platform for the [Magus](https://github.com/MadAppGang/claude-code) Claude Code plugin ecosystem.

## Repository layout

| Directory | Purpose |
|---|---|
| [`platform/`](./platform/) | Autonomous experiment orchestrator. Proposes hypotheses, runs them in parallel git worktrees, measures against a baseline, and merges what works. |
| [`benchmarks/`](./benchmarks/) | Self-contained eval harnesses. Each measures one thing (doc quality, skill routing) and is runnable directly. |
| [`experiments/`](./experiments/) | Structured investigations. Have a stated methodology and produce findings. |
| [`poc/`](./poc/) | Quick spikes and proofs of concept. "Does this even work?" One-off tests, often throwaway. |
| [`docs/`](./docs/) | Architecture, testing guide, contribution tutorials. |
| [`archive/`](./archive/) | Completed work preserved for reference. |

## Quick start

```bash
# Run a benchmark directly (fastest)
cd benchmarks/skill-routing && npx promptfoo eval -c promptfooconfig.yaml

# Run the autonomous experiment loop
bun platform/loop.ts --runs 5           # 5 iterations
bun platform/loop.ts --runs 1 --dry-run # preview without API calls
```

See [`docs/architecture.md`](./docs/architecture.md) for the three-layer measurement story and how `platform/` drives `benchmarks/`.

## Adding to the repo

- **New PoC** (quick spike, unknown if worth formalizing): [`poc/README.md`](./poc/README.md)
- **New experiment** (structured investigation): [`experiments/README.md`](./experiments/README.md)
- **New benchmark** (formal, repeatable measurement): [`docs/adding-a-benchmark.md`](./docs/adding-a-benchmark.md)
- **New experiment plugin** (drive an existing benchmark autonomously): [`docs/adding-an-experiment.md`](./docs/adding-an-experiment.md)
- **Glossary** (benchmark vs experiment vs PoC vs eval): [`docs/glossary.md`](./docs/glossary.md)

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`)
- [claudish](https://github.com/MadAppGang/claudish) CLI (`npm install -g claudish`)
- [Bun](https://bun.sh/) runtime
- OpenRouter API key (for external judge models)

## License

MIT
