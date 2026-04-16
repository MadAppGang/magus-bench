# Adding a new benchmark

This tutorial walks through creating a new measurement instrument. Use it when you have a new *thing to measure* — e.g., "code explanation quality," "test generation accuracy," "agent planning coherence."

If you want to *run* an existing benchmark in an autonomous improvement loop, skip this doc and see `docs/adding-an-experiment.md` instead.

## What a benchmark is responsible for

A benchmark answers one question, repeatedly, with numbers. That's it. Specifically:

1. Run end-to-end with a single command (`./run.sh`, `npx promptfoo eval`, etc.)
2. Accept some form of input (test cases, prompts, reference materials)
3. Produce a structured JSON output that encodes the metrics
4. Own its own baselines for regression comparison (optional but recommended)

A benchmark **does not**:
- Know anything about the platform orchestrator
- Propose changes to itself
- Decide whether a new result is better or worse than an old one — that's what the experiment plugin does

## Skeleton

```
benchmarks/my-benchmark/
├── README.md                  # What does this measure? How to run?
├── run.sh                     # Entry point (or promptfooconfig.yaml for promptfoo-style)
├── test-cases.json            # Inputs
├── prompts/                   # Generation + judge templates if LLM-based
├── results/                   # Gitignored — run outputs land here
│   └── run-YYYYMMDD-HHMMSS/
│       └── report.json        # The structured metrics
└── baselines/                 # Committed — regression anchors
    └── latest/
        └── scores.json
```

## Shape of the output JSON

The output must be stable-schema JSON that an experiment plugin can parse. Minimum fields for a scoring benchmark:

```json
{
  "weighted_score": 7.8,
  "subscores": { "criterion_a": 7.2, "criterion_b": 8.3 },
  "run_id": "run-20260415-120000",
  "judges_used": 7,
  "judges_successful": 7
}
```

Keep the schema simple. The experiment plugin will normalize these into a `Metrics` record (`Record<string, number | string | boolean | null>`) before the engine sees them.

## The simplest case: look at skill-routing

`benchmarks/skill-routing/` is the smallest benchmark in the repo:

- `promptfooconfig.yaml` — the entry point (promptfoo generates the whole pipeline)
- `test-cases.yaml` — 22 routing test cases with `assert` blocks
- `prompts/generate-variations.md` — one-off script for producing new test variants

A promptfoo run produces `results/latest.json` with pass/fail counts per case. That's enough for the `agent-routing` experiment plugin to drive optimization.

## Checklist

- [ ] Create `benchmarks/<name>/`
- [ ] Write a `README.md` explaining what it measures and how to run it
- [ ] Add an entry point (`run.sh` or equivalent) that accepts `--dry-run` and `--output-dir <dir>`
- [ ] Emit a stable-schema JSON report at a known path inside the output dir
- [ ] Add `benchmarks/<name>/results/` to `.gitignore` (or `results/` if you prefer — check the existing pattern)
- [ ] Commit an initial `baselines/latest/` snapshot once you have a trusted first result
- [ ] Verify with `cd benchmarks/<name> && ./run.sh --dry-run`
- [ ] Optionally: write an experiment plugin under `platform/plugins/` to drive autonomous optimization (see `docs/adding-an-experiment.md`)

## The archive rule

If an old benchmark or study gets superseded or wound down, don't delete it — move it to `archive/<name>-YYYY-MM/` with a short `README.md` explaining what it was and why it's archived. History is expensive to reconstruct.
