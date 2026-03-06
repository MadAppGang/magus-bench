# Tech-Writer Eval

4-way blind documentation quality benchmark comparing human-written reference documentation against AI-generated alternatives.

## Design

**Contestants** (4 approaches, blind-labeled A–D per judge):

| Approach | Model | Prompt | Description |
|----------|-------|--------|-------------|
| `default` | Claude (internal) | `generate-default.md` | Vanilla documentation prompt, no style rules |
| `techwriter` | Claude (internal) | `generate-techwriter.md` | Anti-slop rules + Diataxis template + readability constraints |
| `reference` | — | — | Human-written doc (VS Code Extension Anatomy, CC BY 4.0) |
| `gemini` | Gemini 3 Flash | `generate-techwriter.md` | Same anti-slop prompt, different model |

**Judges** (7-model panel, each sees samples in independently randomized order):

| Judge | Model | Method |
|-------|-------|--------|
| internal | Claude (native) | `claude -p` |
| minimax | MiniMax M2.5 | claudish via OpenRouter |
| kimi | Kimi K2.5 | claudish via OpenRouter |
| glm | GLM-5 | claudish via OpenRouter |
| gemini | Gemini 3.1 Pro Preview | claudish via OpenRouter |
| gpt | GPT-5.3 Codex | claudish via OpenRouter |
| qwen | Qwen 3 235B | claudish via OpenRouter |

**Scoring**: 9 criteria with weights (total 14x), Borda count ranking, Friedman omnibus test, Wilcoxon pairwise, bootstrap 95% CI.

**Anti-bias**: Per-judge independent sample ordering (not a single shared shuffle). Anti-length-bias instruction in judge prompt. Blind labels (Sample A/B/C/D) with no approach names.

## Pipeline

```
run.sh
├── Phase 1: Generate     (4 approaches → 4 output.md files)
├── Phase 2: Judge        (7 judges × 4 samples = 7 scored responses)
└── Phase 3: Analyze      (analyze-results.ts → report + statistics)
```

## Files

```
tech-writer-eval/
├── run.sh                         # Main orchestrator (bash)
├── analyze-results.ts             # Bun/TS analyzer (Borda, Friedman, bootstrap CI)
├── test-cases.json                # Config: approaches, criteria, judges, thresholds
├── .gitignore                     # Ignores transient files (*.pid, *.tmp)
├── prompts/
│   ├── generate-default.md        # Vanilla doc prompt
│   ├── generate-techwriter.md     # Anti-slop + Diataxis prompt
│   └── judge-template-4way.md     # 4-sample blind judge template
├── reference/
│   └── reference.md               # VS Code Extension Anatomy (CC BY 4.0)
└── results/
    └── run-YYYYMMDD-HHMMSS/       # Per-run artifacts
        ├── test-cases.json        # Frozen config snapshot
        ├── sample-mapping.json    # Per-judge blind orderings
        ├── generate/{approach}/   # Generation outputs + transcripts
        ├── judge/{judge}/         # Judge responses + transcripts
        └── report/                # Final MD + JSON reports
```

## Usage

```bash
# Full run (requires API keys)
./run.sh

# Dry run — preview pipeline
./run.sh --dry-run

# Re-analyze existing results
bun analyze-results.ts results/run-20260306-085812
```

## Iteration Log

### Run 1 — 2026-03-06 (`run-20260306-085812`)

**Topic**: How skill injection works in the dev plugin's `/dev:implement` command

**Result**: 6/7 judges parsed (qwen failed — invalid model ID `qwen3.5-plus-02-15`)

| Rank | Approach | Weighted Score | Borda (max 18) | Gap to Reference |
|------|----------|---------------|-----------------|------------------|
| 1st | **techwriter** | 7.9 | 14 | +0.2 |
| 2nd | default | 7.3 | 9 | -0.4 |
| 3rd | reference | 7.7 | 8 | — |
| 4th | gemini | 7.1 | 5 | -0.6 |

**Statistics**: Friedman chi2=1.4, p=0.71 (not significant — high inter-judge variance)

**Output sizes**: default 32K, techwriter 14K, reference 6K, gemini 6K

**Judge agreement**: 4/6 judges ranked techwriter 1st. Kimi ranked reference 1st. MiniMax ranked default 1st.

**Notable findings**:
- techwriter beat human reference on weighted score (+0.2 gap), driven by Diagram Quality (8.3 vs 3.3) — the VS Code docs have no Mermaid/flowchart diagrams
- Reference scored highest on Conciseness (8.5), Readability (8.5), Internal Consistency (8.8), and Slop Absence (8.2)
- Default Claude produced 5.5x more text than reference (32K vs 6K) but scored lower on conciseness (5.7 vs 8.5)
- Anti-slop rules cut output size by 57% (32K → 14K) while improving quality on 7/9 criteria

**Bugs found & fixed**:
- `timeout` command not available on macOS — replaced with portable `run_with_timeout()` bash function
- claudish stdin redirect broken when backgrounded — fixed with direct `< file > output &` pattern
- Missing commas in `sample-mapping.json` — fixed separator in run.sh
- Coaching prefix contamination from dev plugin SessionStart hook — added regex strip in `parseJudgeResponse()`
- Invalid qwen model ID — updated to `qwen/qwen3-235b-a22b` for next run
