# Adding to the repo

This repo supports four kinds of experimental work, from quick spikes to autonomous optimization. Pick the lightest one that fits your question.

## Which kind of experiment?

Ask these questions in order. Stop at the first "yes."

1. Do you need a quick go/no-go answer you might throw away? --> **PoC**
2. Are you comparing multiple variants with a written methodology? --> **Experiment**
3. Are you building a repeatable measurement tool with stable output? --> **Benchmark**
4. Do you want the platform to optimize a benchmark autonomously? --> **Experiment plugin**

| Question | Kind | Directory | Rigor | Lifetime |
|---|---|---|---|---|
| "Does this even work?" | PoC | `poc/<name>/` | README + script + output | Days |
| "Which of these N approaches wins?" | Experiment | `experiments/<name>-YYYY-MM/` | Methodology, arms, RESULTS.md | Weeks-months |
| "How do we measure X repeatably?" | Benchmark | `benchmarks/<name>/` | Stable JSON schema, baselines, `run.sh` | Permanent |
| "Can we improve X automatically?" | Plugin | `platform/plugins/<name>/experiment.ts` | TypeScript, `Experiment` interface | Permanent |

Each kind builds on the previous. A PoC validates an idea; an experiment structures the comparison; a benchmark formalizes the measurement; a plugin automates the improvement loop.

## Adding a PoC

Create a directory under `poc/` with a short, descriptive name (`try-gemini-3-on-reference`, `cheap-judge-spike`). Add at minimum:

1. `README.md` -- the question, how to run, what you found
2. A script or notebook that reproduces the result
3. Raw output (committed or gitignored, your call)

No required structure beyond that. When the PoC proves out, graduate it to `experiments/` or `benchmarks/`. If the idea dies, move it to `archive/`.

Full conventions: [`poc/README.md`](../poc/README.md).

## Adding an experiment

Create `experiments/<name>-YYYY-MM/` (date suffixes prevent staleness ambiguity). Typical layout:

```
experiments/judge-cost-tradeoff-2026-05/
├── README.md              # Question, methodology, TL;DR findings
├── RESULTS.md             # Full write-up
├── run-experiment.sh      # Reproducible harness
├── arms/                  # One directory per variant
│   ├── baseline/
│   ├── variant-a/
│   └── variant-b/
└── journal/               # Per-session logs
```

State the hypothesis upfront in `README.md`. Define the arms, the metrics, and what counts as a win before running anything. Write findings into `RESULTS.md` when done.

An experiment can invoke the platform orchestrator as one arm (e.g., `bun platform/loop.ts --runs 5 --experiment config-a`). The experiment owns the comparison; the platform owns the loop inside each arm.

Full conventions: [`experiments/README.md`](../experiments/README.md).

## Adding a benchmark

A benchmark answers one question, repeatedly, with numbers. It runs end-to-end from a single command, emits stable-schema JSON, and knows nothing about the platform orchestrator.

See [`docs/adding-a-benchmark.md`](adding-a-benchmark.md) for the full skeleton, output schema, checklist, and a walkthrough of the smallest benchmark (`benchmarks/skill-routing/`).

## Adding an experiment plugin

An experiment plugin wraps a benchmark for autonomous optimization. The platform runs a six-phase loop (research, plan, implement, evaluate, review, decide) and your plugin controls how "evaluate" and "decide" work.

Write a single TypeScript file:

```
platform/plugins/my-experiment/experiment.ts
```

### The Experiment interface

Defined in `platform/engine/types.ts`, the interface has ~14 required members in six logical sections:

| Section | Members | Purpose |
|---|---|---|
| Identity | `name`, `description` | Config ID + logging |
| Execution | `run(worktreePath, outputDir)` | Spawn the benchmark, return metrics |
| Baseline I/O | `readBaseline()`, `saveBaseline(runDir)` | Persist/read baseline JSON |
| Decision | `isImprovement(current, baseline)`, `isRegression(...)` | Plugin owns keep/drop |
| Display | `formatMetrics`, `formatDelta`, `formatBaseline` | Compact strings for journal |
| Research guidance | `changeableFiles`, `contextFiles`, `researchHints`, `dependentVariables` | Drive agent prompts + isolation |

Two optional members also exist: `alwaysAllowedChanges` (extra file patterns for diff verification) and `decisionCriteriaText` (custom reviewer prompt text).

### Walkthrough: agent-routing plugin

`platform/plugins/agent-routing/experiment.ts` (457 lines) wraps the promptfoo-based skill-routing benchmark.

**Path constants at the top** -- locate the benchmark relative to repo root:

```ts
const REPO_ROOT = join(import.meta.dir, "../../..");
const EVAL_DIR = join(REPO_ROOT, "benchmarks", "skill-routing");
```

**`run()`** -- spawn the benchmark, parse JSON, return a `Metrics` object:

```ts
async run(worktreePath: string, outputDir: string): Promise<Metrics> {
  const configPath = join(worktreePath, "benchmarks", "skill-routing", "promptfooconfig.yaml");
  // ... spawnShell(["npx", "promptfoo@0.103.5", "eval", ...]) ...
  return { pass_rate: ..., failed_count: ..., ... };
}
```

**`isImprovement` and `isRegression`** -- define what counts as better or worse:

```ts
isImprovement(current, baseline) {
  return current.pass_rate > baseline.pass_rate;
},
isRegression(current, baseline) {
  return current.failed_count > baseline.failed_count + 1; // allow 1-case slack
},
```

**`changeableFiles`** -- glob list of what the implementer agent may edit:

```ts
changeableFiles: [
  "benchmarks/skill-routing/test-cases.yaml",
  "benchmarks/skill-routing/promptfooconfig.yaml",
],
```

The platform's `diff-verifier.ts` enforces this list. If the agent touches anything outside it, the approach drops with `status: "isolation_failed"`.

**`researchHints`** -- domain knowledge fed into the research agent:

```ts
researchHints: [
  "The eval tests Skill tool vs Task tool disambiguation — skills must use the Skill tool.",
  "CLAUDE.md routing table entries must direct complex tasks to the right specialist.",
  // ...
],
```

### Registering the plugin

Add one entry to the `REGISTRY` object in `platform/engine/plugin-registry.ts`:

```ts
const REGISTRY: Record<string, () => Promise<Experiment>> = {
  "tech-writer-quality": () => import("../plugins/tech-writer-quality/experiment.ts").then(m => m.default),
  "agent-routing":       () => import("../plugins/agent-routing/experiment.ts").then(m => m.default),
  "prompt-cost-optimizer": () => import("../plugins/prompt-cost-optimizer/experiment.ts").then(m => m.default),
  "my-experiment":       () => import("../plugins/my-experiment/experiment.ts").then(m => m.default),
};
```

Then set `experiment_id` in `platform/config.json`:

```json
{ "experiment_id": "my-experiment" }
```

### Verify with dry-run

```bash
bun platform/loop.ts --runs 1 --dry-run --experiment my-experiment
```

All six phases should complete, writing stub outputs to `platform/runs/iteration-1/`.

```bash
bun platform/loop.ts --runs 1 --experiment my-experiment
```

One real iteration. Watch `platform/journal.md` for the entry.

### Gotchas

- **Path math from plugin**: `import.meta.dir` resolves to `platform/plugins/<name>/`. Use `../../..` to reach the repo root, not `../..` (that gives you `platform/`).
- **Load-time validation**: `validatePlugin()` in `plugin-registry.ts` checks all required fields are non-null. A missing field causes a runtime error, not a TypeScript error -- run a dry-run before committing.
- **Deterministic decision logic**: `isImprovement` / `isRegression` must not call an LLM. The reviewer agent's vote is a separate input; the plugin's verdict is the final authority.
- **Paths are repo-relative, not absolute**: `changeableFiles` and `contextFiles` get matched against `git diff --name-only` output, which is always relative to repo root.

## Graduation paths

Ideas move from loose to rigorous as confidence grows:

```
PoC  ──proves out──>  Experiment  ──stabilizes──>  Benchmark  ──automates──>  Plugin
```

A PoC showing promise becomes a structured experiment with arms and methodology. When the experiment identifies a metric worth tracking long-term, extract the measurement into a benchmark. When you want the platform to optimize that metric automatically, write a plugin.

Not every idea needs to reach "plugin." Most PoCs die or get absorbed into code changes. That's fine -- the point is to match rigor to confidence.

**Archive, don't delete.** When a PoC, experiment, or benchmark gets superseded, move it to `archive/<name>-YYYY-MM/` with a short README explaining what was found and why it's archived. Git history is expensive to reconstruct from scratch.
