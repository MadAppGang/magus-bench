# Magus Bench

Benchmarks and an autonomous experiment platform for the [Magus](https://github.com/MadAppGang/claude-code) plugin ecosystem.

## Experiment platform

The [experiment loop](./loop/) proposes improvements, tests them in isolated git worktrees, and merges what works. Each experiment is a TypeScript plugin — add a new one by writing a single file.

```bash
bun loop/loop.ts --runs 5           # run 5 iterations
bun loop/loop.ts --runs 1 --dry-run # preview without API calls
touch loop/STOP                      # stop after current phase
```

See [loop/README.md](./loop/README.md) for the full guide including how to write new experiment plugins.

### Experiments

| Experiment | Plugin | Description |
|------------|--------|-------------|
| [tech-writer-quality](./loop/experiments/tech-writer-quality/) | `experiment.ts` | Improve documentation quality via prompt/rubric iteration. 4-way blind comparison, 7-model judge panel, Borda + Friedman statistics. |
| [agent-routing](./loop/experiments/agent-routing/) | `experiment.ts` | Improve Claude Code skill/agent routing correctness. Promptfoo benchmark, 22 test cases across 11 routing categories. |

## Eval harnesses

Each eval harness runs independently and is also callable by the experiment loop.

| Eval | Entry point | Description |
|------|-------------|-------------|
| [tech-writer-eval](./tech-writer-eval/) | `run.sh` | 4-way blind doc quality comparison: human reference vs bare Claude vs Claude+anti-slop vs Gemini Flash, judged by 7-model panel |
| [skill-routing-eval](./skill-routing-eval/) | `promptfooconfig.yaml` | Promptfoo benchmark testing Skill-tool vs Task-tool disambiguation, routing-table honoring, and spelling correctness |

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`)
- [claudish](https://github.com/MadAppGang/claudish) CLI (`npm install -g claudish`)
- [Bun](https://bun.sh/) runtime (for TypeScript)
- OpenRouter API key (for external model judges)

## Running an eval directly

```bash
cd tech-writer-eval
./run.sh              # full run: generate → judge → analyze
./run.sh --dry-run    # preview without API calls
```

Results land in `results/run-YYYYMMDD-HHMMSS/` with a markdown report.

## License

MIT
