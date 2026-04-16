# Tech-Writer 4-Way Benchmark Results

**Topic**: How skill injection works in the dev plugin's /dev:implement command
**Date**: 2026-03-16
**Judges**: 7/7 successful

## Table 1: All Contestants (Absolute Ranking)

| Approach | slop | writing_craft | readability | structure | conciseness | accuracy | disclosure | diagrams | overall | Weighted | Borda |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| techwriter | 8.1 | 8.4 | 8.1 | 8.6 | 8.3 | 8.4 | 8.1 | 8.7 | 8.4 | 8.3 | 1st (15) |
| default | 7.3 | 7.9 | 7.6 | 9.3 | 6.4 | 8.7 | 8.6 | 7 | 7.6 | 7.9 | 2nd (10) |
| gemini | 7.7 | 7.6 | 8.1 | 8.3 | 8.3 | 7.9 | 7.7 | 7.1 | 7.4 | 7.8 | 3rd (9) |
| reference | 8.3 | 7.9 | 8.4 | 7.7 | 8.6 | 9.3 | 7.9 | 4.7 | 7.6 | 8 | 4th (8) |

> Note: Reference doc scored on the same rubric as AI contestants. The `slop`
> criterion inherently favors human-authored text even at 2x weight.

## Table 2: AI Approaches (Reference as Calibration Anchor)

| Approach | slop | writing_craft | readability | structure | conciseness | accuracy | disclosure | diagrams | overall | Weighted | Borda | Gap to Ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference (baseline) | 8.3 | 7.9 | 8.4 | 7.7 | 8.6 | 9.3 | 7.9 | 4.7 | 7.6 | 8 | 8 pts | — |
| techwriter | 8.1 | 8.4 | 8.1 | 8.6 | 8.3 | 8.4 | 8.1 | 8.7 | 8.4 | 8.3 | 1st (15) | +0.3 |
| default | 7.3 | 7.9 | 7.6 | 9.3 | 6.4 | 8.7 | 8.6 | 7 | 7.6 | 7.9 | 2nd (10) | -0.1 |
| gemini | 7.7 | 7.6 | 8.1 | 8.3 | 8.3 | 7.9 | 7.7 | 7.1 | 7.4 | 7.8 | 3rd (9) | -0.2 |

Gap to reference: default -0.1 | techwriter +0.3 | gemini -0.2

## Per-Judge Details

| Judge | Model | Parse | Ranking (1st→4th) | Reasoning |
|-------|-------|-------|-------------------|-----------|
| internal | internal | json | techwriter > gemini > default > reference | B leads decisively on writing craft and slop avoidance — its distinctive practitioner voice ('That's the point.', 'Gate ... |
| minimax | minimax-m2.5 | json | reference > gemini > techwriter > default | Sample B (VS Code official docs) edges out A as the best due to cleaner prose with minimal slop and excellent tutorial v... |
| kimi | kimi-k2.5 | json | techwriter > reference > default > gemini | Sample A excels with dense, precise technical writing, useful Mermaid diagrams, and no AI slop. Sample D is clean and pr... |
| glm | glm-5 | json | techwriter > gemini > default > reference | Sample D wins with excellent writing craft, efficient length, two well-designed diagrams, and thoughtful UX (skip links)... |
| gemini | gemini-3.1-pro-preview | json | default > techwriter > gemini > reference | Sample B is the most comprehensive and brilliantly structured developer guide, excelling in progressive disclosure. Samp... |
| gpt | gpt-5.3-codex | json | techwriter > default > gemini > reference | D delivers the best publishable balance of technical depth, instructional clarity, and scannable structure while staying... |
| qwen | qwen/qwen3-235b-a22b | json | reference > default > gemini > techwriter | Samples D (VS Code) and A (Claude Code Skill system) both demonstrate exceptional technical clarity and structure, but D... |

## Score Distribution

### AI Slop Absence (`slop`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.1 | 1.2 | 6 | 9 |
| default | 7.3 | 1.4 | 6 | 9 |
| gemini | 7.7 | 1 | 6 | 9 |
| reference | 8.3 | 1.3 | 7 | 10 |

### Writing Craft (`writing_craft`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.4 | 1 | 7 | 9 |
| default | 7.9 | 1.5 | 6 | 9 |
| gemini | 7.6 | 0.5 | 7 | 8 |
| reference | 7.9 | 1.2 | 7 | 10 |

### Readability (`readability`, 1.5x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.1 | 1.2 | 6 | 9 |
| default | 7.6 | 1.5 | 6 | 10 |
| gemini | 8.1 | 0.4 | 8 | 9 |
| reference | 8.4 | 1 | 7 | 10 |

### Document Structure (`structure`, 1.5x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.6 | 0.5 | 8 | 9 |
| default | 9.3 | 1.1 | 7 | 10 |
| gemini | 8.3 | 0.8 | 7 | 9 |
| reference | 7.7 | 1.3 | 6 | 10 |

### Conciseness (`conciseness`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.3 | 1 | 7 | 9 |
| default | 6.4 | 1.7 | 4 | 9 |
| gemini | 8.3 | 0.5 | 8 | 9 |
| reference | 8.6 | 0.8 | 8 | 10 |

### Internal Consistency (`accuracy`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.4 | 1 | 7 | 10 |
| default | 8.7 | 0.8 | 8 | 10 |
| gemini | 7.9 | 1.5 | 5 | 9 |
| reference | 9.3 | 0.5 | 9 | 10 |

### Progressive Disclosure (`disclosure`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.1 | 0.9 | 7 | 9 |
| default | 8.6 | 1.5 | 6 | 10 |
| gemini | 7.7 | 0.5 | 7 | 8 |
| reference | 7.9 | 1.1 | 7 | 10 |

### Diagram Quality (`diagrams`, 1x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.7 | 0.5 | 8 | 9 |
| default | 7 | 1.9 | 3 | 9 |
| gemini | 7.1 | 0.7 | 6 | 8 |
| reference | 4.7 | 3.4 | 1 | 9 |

### Overall Quality (`overall`, 2x)

| Approach | Mean | StdDev | Min | Max |
|----------|------|--------|-----|-----|
| techwriter | 8.4 | 1 | 7 | 9 |
| default | 7.6 | 1.1 | 6 | 9 |
| gemini | 7.4 | 0.8 | 6 | 8 |
| reference | 7.6 | 1.5 | 6 | 10 |

## Statistical Analysis

**Friedman omnibus**: χ² = 1.63, p = 0.66

**Wilcoxon pairwise** (Bonferroni corrected):

| Pair | p-value |
|------|---------|
| default vs techwriter | 1 |
| default vs reference | 1 |
| default vs gemini | 1 |
| techwriter vs reference | 1 |
| techwriter vs gemini | 1 |
| reference vs gemini | 1 |

**Bootstrap 95% CI** (weighted score, 1000 resamples):

| Approach | CI Low | CI High |
|----------|--------|---------|
| techwriter | 7.81 | 8.91 |
| default | 7.02 | 8.64 |
| gemini | 7.42 | 8.12 |
| reference | 7.31 | 8.71 |

---

_With 7 judges, results are directional. Deltas under ~0.8 points are within measurement noise at typical inter-judge variance (sigma ~0.9). Wilcoxon p-values are Bonferroni corrected for 6 pairs._

