# Magus Bench

Benchmarks for the [Magus](https://github.com/MadAppGang/claude-code) plugin ecosystem.

Each benchmark lives in its own directory with a dedicated README, test harness, and archived results.

## Benchmarks

| Benchmark | Description | Status |
|-----------|-------------|--------|
| [tech-writer-eval](./tech-writer-eval/) | 4-way blind documentation quality comparison: human reference vs bare Claude vs Claude+anti-slop vs Gemini Flash, judged by 7-model panel | Active |

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`)
- [claudish](https://github.com/MadAppGang/claudish) CLI (`npm install -g claudish`)
- [Bun](https://bun.sh/) runtime (for TypeScript analyzers)
- OpenRouter API key (for external model judges)

## Running a Benchmark

Each benchmark has a `run.sh` entry point and a `test-cases.json` config:

```bash
cd tech-writer-eval
./run.sh              # full run: generate → judge → analyze
./run.sh --dry-run    # preview pipeline without API calls
```

Results land in `results/run-YYYYMMDD-HHMMSS/` with a markdown report.

## License

MIT
