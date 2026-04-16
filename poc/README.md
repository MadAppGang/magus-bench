# PoC (proofs of concept)

Quick spikes. "Does this even work?" One-off tests to answer a single narrow question fast, often with the expectation they'll be thrown away.

## When to put something here

- You want to test a hypothesis in hours, not days
- The output is "go / no-go" rather than a measurement
- You don't yet know if the idea is worth formalizing
- You need to play with an API, model, or library before committing to it

## When *not* to put something here

- You're building a repeatable measurement → use [`../benchmarks/`](../benchmarks/)
- You're running a structured investigation → use [`../experiments/`](../experiments/)
- You're driving something autonomously → write a plugin in [`../platform/plugins/`](../platform/plugins/)

## Shape

No required structure. Minimum is a `README.md` at the top of the PoC explaining:

1. The question being answered
2. How to run / reproduce
3. What was found (update after the experiment)

Typical layouts:

```
poc/
├── try-gemini-3-on-reference/
│   ├── README.md
│   ├── run.sh
│   └── output.txt
├── cheap-judge-spike/
│   ├── README.md
│   ├── notes.md
│   └── results.json
└── ...
```

## Lifecycle

1. **Active.** PoC lives here while it's being worked on.
2. **Graduated.** If the idea proves out, it moves to `../benchmarks/` (formal measurement) or `../experiments/` (structured investigation). Leave a breadcrumb README behind here if the move is surprising.
3. **Archived.** If the idea is done, superseded, or the answer is "no," move the whole directory to `../archive/<name>-YYYY-MM/` with a short README explaining what was found. Don't delete — preserve the trail.

## Naming

Short, descriptive, imperative if possible: `try-gemini-3-on-reference`, `cheap-judge-spike`, `test-prompt-injection-resistance`. Avoid dates in the name (git history has those) unless the PoC is intrinsically temporal.
