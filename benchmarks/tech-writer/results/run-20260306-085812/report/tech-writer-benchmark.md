# Tech-Writer 4-Way Benchmark Results

**Topic**: How skill injection works in the dev plugin's /dev:implement command
**Date**: 2026-03-05
**Judges**: 6/7 successful

## Table 1: All Contestants (Absolute Ranking)

| Approach | slop | writing_craft | readability | structure | conciseness | accuracy | disclosure | diagrams | overall | Weighted | Borda |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| techwriter | 7.5 | 7.8 | 8 | 8.3 | 7.3 | 8 | 8 | 8.3 | 7.8 | 7.9 | 1st (14) |
| default | 6.7 | 7.3 | 7 | 8.7 | 5.7 | 8.2 | 7.7 | 6.8 | 7.3 | 7.3 | 2nd (9) |
| reference | 8.2 | 7.8 | 8.5 | 7.7 | 8.5 | 8.8 | 7.5 | 3.3 | 7.3 | 7.7 | 3rd (8) |
| gemini | 6.5 | 6.8 | 7.7 | 7.5 | 7.2 | 7.7 | 7.2 | 7 | 6.8 | 7.1 | 4th (5) |

> Note: Reference doc scored on the same rubric as AI contestants. The `slop`
> criterion inherently favors human-authored text even at 2x weight.

## Table 2: AI Approaches (Reference as Calibration Anchor)

| Approach | slop | writing_craft | readability | structure | conciseness | accuracy | disclosure | diagrams | overall | Weighted | Borda | Gap to Ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference (baseline) | 8.2 | 7.8 | 8.5 | 7.7 | 8.5 | 8.8 | 7.5 | 3.3 | 7.3 | 7.7 | 8 pts | — |
| techwriter | 7.5 | 7.8 | 8 | 8.3 | 7.3 | 8 | 8 | 8.3 | 7.8 | 7.9 | 1st (14) | +0.2 |
| default | 6.7 | 7.3 | 7 | 8.7 | 5.7 | 8.2 | 7.7 | 6.8 | 7.3 | 7.3 | 2nd (9) | -0.4 |
| gemini | 6.5 | 6.8 | 7.7 | 7.5 | 7.2 | 7.7 | 7.2 | 7 | 6.8 | 7.1 | 3rd (5) | -0.6 |

Gap to reference: default -0.4 | techwriter +0.2 | gemini -0.6

## Per-Judge Details

| Judge | Model | Parse | Ranking (1st→4th) | Reasoning |
|-------|-------|-------|-------------------|-----------|
| internal | internal | json | techwriter > default > reference > gemini | Sample D leads on nearly every criterion — zero detectable slop, punchy sentence variety ('Files are not.'), strong merm... |
| minimax | minimax-m2.5 | json | default > reference > techwriter > gemini | Sample A ranks highest due to superior structure with clear metadata, logical progression from basics to advanced, and c... |
| kimi | kimi-k2.5 | fenced_json | reference > gemini > techwriter > default | Sample D is clearly professional human-written documentation (Microsoft VS Code docs) with natural sentence variation, d... |
| glm | glm-5 | json | techwriter > default > reference > gemini | A achieves the best balance of conciseness, craft, and visual aids with excellent Mermaid diagrams and skip-link navigat... |
| gemini | gemini-3.1-pro-preview | json | techwriter > default > gemini > reference | Sample A is the strongest, featuring high information density, direct language devoid of AI slop, and excellent use of d... |
| gpt | gpt-5.3-codex | json | techwriter > gemini > reference > default | D is the strongest blend of practical structure, progressive disclosure, and useful flow diagrams with relatively contro... |

## Score Distribution

### AI Slop Absence (`slop`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 7.5 | 2 | 4 | 9 |
| default | 6.7 | 2 | 3 | 8 |
| reference | 8.2 | 1 | 7 | 9 |
| gemini | 6.5 | 1.4 | 5 | 8 |

### Writing Craft (`writing_craft`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 7.8 | 1.6 | 5 | 9 |
| default | 7.3 | 1.8 | 4 | 9 |
| reference | 7.8 | 0.8 | 7 | 9 |
| gemini | 6.8 | 1 | 5 | 8 |

### Readability (`readability`, 1.5x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8 | 1.3 | 6 | 9 |
| default | 7 | 1.5 | 4 | 8 |
| reference | 8.5 | 0.5 | 8 | 9 |
| gemini | 7.7 | 0.5 | 7 | 8 |

### Document Structure (`structure`, 1.5x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.3 | 1 | 7 | 9 |
| default | 8.7 | 1.4 | 6 | 10 |
| reference | 7.7 | 1 | 6 | 9 |
| gemini | 7.5 | 0.8 | 6 | 8 |

### Conciseness (`conciseness`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 7.3 | 2.1 | 4 | 9 |
| default | 5.7 | 1.5 | 3 | 7 |
| reference | 8.5 | 0.5 | 8 | 9 |
| gemini | 7.2 | 1.2 | 5 | 8 |

### Internal Consistency (`accuracy`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8 | 0.9 | 7 | 9 |
| default | 8.2 | 1.5 | 6 | 10 |
| reference | 8.8 | 0.4 | 8 | 9 |
| gemini | 7.7 | 0.8 | 7 | 9 |

### Progressive Disclosure (`disclosure`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8 | 1.7 | 5 | 9 |
| default | 7.7 | 2 | 4 | 9 |
| reference | 7.5 | 0.5 | 7 | 8 |
| gemini | 7.2 | 1 | 6 | 8 |

### Diagram Quality (`diagrams`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.3 | 0.8 | 7 | 9 |
| default | 6.8 | 2 | 3 | 9 |
| reference | 3.3 | 2.7 | 1 | 7 |
| gemini | 7 | 0.9 | 6 | 8 |

### Overall Quality (`overall`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 7.8 | 1.6 | 5 | 9 |
| default | 7.3 | 1.8 | 4 | 9 |
| reference | 7.3 | 1 | 6 | 9 |
| gemini | 6.8 | 0.8 | 6 | 8 |

## Statistical Analysis

**Friedman omnibus**: χ² = 1.4, p = 0.71

**Wilcoxon pairwise** (Bonferroni corrected):

| Pair | p-value |
|------|---------|
| default vs techwriter | 0.72 |
| default vs reference | 1 |
| default vs gemini | 1 |
| techwriter vs reference | 1 |
| techwriter vs gemini | 1 |
| reference vs gemini | 1 |

**Bootstrap 95% CI** (weighted score, 1000 resamples):

| Approach | CI Low | CI High |
|----------|--------|---------|
| techwriter | 6.83 | 8.78 |
| default | 6.07 | 8.31 |
| reference | 7.29 | 8.17 |
| gemini | 6.57 | 7.56 |

---

_With 6 judges, results are directional. Deltas under ~0.8 points are within measurement noise at typical inter-judge variance (sigma ~0.9). Wilcoxon p-values are Bonferroni corrected for 6 pairs._

## Failed Judges

- qwen

