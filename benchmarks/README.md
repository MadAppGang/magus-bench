# Benchmarks

Self-contained eval harnesses. Each benchmark measures one thing and runs standalone — you don't need the `platform/` orchestrator to use them.

## Available benchmarks

| Benchmark | Measures | Entry point | Typical run |
|---|---|---|---|
| [`tech-writer/`](./tech-writer/) | Documentation quality via 4-way blind comparison, 7-model judge panel, Borda + Friedman stats | `run.sh` | 20–40 min, $5–15 |
| [`skill-routing/`](./skill-routing/) | Claude Code skill/agent routing correctness across 22 cases | `promptfooconfig.yaml` | ~2 min, ~$0.10 |

## Running directly

```bash
# Tech-writer: full generate → judge → analyze pipeline
cd benchmarks/tech-writer && ./run.sh
./run.sh --dry-run              # preview without API calls

# Skill routing
cd benchmarks/skill-routing && npx promptfoo eval -c promptfooconfig.yaml
npx promptfoo view              # interactive results viewer
```

Results land in `<benchmark>/results/run-YYYYMMDD-HHMMSS/` (gitignored). Baselines for regression comparison live in `<benchmark>/baselines/latest/`.

## Driven autonomously by the platform

Each benchmark has a matching experiment plugin in `platform/plugins/` that wraps it for autonomous optimization. The plugin knows how to spawn the benchmark, parse its JSON output into metrics, and decide whether a result is better than the stored baseline. See [`../docs/adding-an-experiment.md`](../docs/adding-an-experiment.md).

## Adding a benchmark

See [`../docs/adding-a-benchmark.md`](../docs/adding-a-benchmark.md) for the full tutorial. Short version: create `benchmarks/<name>/` with a `run.sh` that accepts `--dry-run` and emits stable-schema JSON to `results/run-*/report.json`.
