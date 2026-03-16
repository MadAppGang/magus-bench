# Baselines — Regression Snapshots

This directory stores golden output snapshots from known-good benchmark runs.
Use them to detect quality regressions across prompt changes, model updates,
or environment drift.

## Directory layout

```
baselines/
├── README.md           # This file (tracked in git)
├── .gitkeep            # Keeps the directory tracked (tracked in git)
├── latest/             # Most recent baseline (not tracked in git)
│   ├── scores.json     # Per-approach, per-criterion weighted scores
│   └── metadata.json   # Run date, judge models, approach configs
└── run-YYYYMMDD-HHMMSS/   # Archived baseline snapshots (not tracked)
    ├── scores.json
    └── metadata.json
```

## Workflow

### 1. Capture a baseline from a completed run

After a run you are satisfied with:

```bash
./capture-baseline.sh results/run-20260306-085812
```

This writes `baselines/run-20260306-085812/` and updates `baselines/latest/`
to point to that snapshot.

### 2. Compare a new run against the baseline

```bash
./compare-baseline.sh results/run-20260316-120000
```

Prints a table of score deltas per approach and criterion. Exits with code 1
if any approach-criterion pair has dropped more than 0.5 points (regression
threshold). Suitable for CI.

### 3. Integrate into a full run

Pass `--compare-baseline` to `run.sh`:

```bash
./run.sh --compare-baseline
```

The comparison runs automatically after Phase 3 (Analyze) using the new
results directory.

## What counts as a regression?

A score delta of **-0.5 or worse** on any (approach, criterion) pair triggers
a regression warning. Given typical inter-judge variance (~0.9 sigma with 6
judges), a 0.5-point threshold catches meaningful drops while ignoring noise.

## Files tracked in git

Only `README.md` and `.gitkeep` are tracked. All snapshot data is listed in
`.gitignore` so baselines are local-only by default. Commit snapshots
explicitly if you want team-wide golden references.
