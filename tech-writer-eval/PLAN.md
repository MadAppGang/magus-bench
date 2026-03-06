# Tech-Writer Eval — Next Steps Plan

## Current State (after Run 1)

**What works**: Pipeline runs end-to-end. 4-way blind comparison with per-judge randomization. Borda count + weighted scoring + Friedman/Wilcoxon/bootstrap CI. Coaching prefix contamination fixed. Qwen model ID fixed.

**What doesn't**: Results are directional but not statistically significant (p=0.71). Only 1 topic tested. Diagram Quality criterion unfairly penalizes docs without Mermaid. 6/7 judges (qwen failed). Default Claude output is pathologically verbose (32K for a topic that needs ~6K).

## Priority 1: Statistical Power

**Problem**: With 1 topic and 6-7 judges, Friedman test has very low power. Deltas under ~0.8 points are noise.

**Fix**: Add more topics. Each topic is a repeated measure — 4 topics × 7 judges = 28 data points, enough for p < 0.05 on a 0.5-point delta.

### Candidate Topics

Pick topics with existing human-written reference docs (CC BY 4.0 or similar) to keep the 4-way design:

| # | Topic | Reference Source | Why |
|---|-------|-----------------|-----|
| 1 | VS Code Extension Anatomy | code.visualstudio.com (CC BY 4.0) | Already done (Run 1) |
| 2 | Git Rebase Explained | git-scm.com Pro Git (CC BY-NC-SA 3.0) | Well-known topic, good reference doc, tests narrative explanation |
| 3 | Docker Multi-Stage Builds | docs.docker.com (Apache 2.0) | Procedural how-to, tests step-by-step instructions |
| 4 | PostgreSQL JSONB Operators | postgresql.org docs (PostgreSQL License) | Reference-heavy, tests table/code formatting |
| 5 | React useEffect Cleanup | react.dev (CC BY 4.0) | Conceptual explanation, tests progressive disclosure |

**Action**: Select 3 more topics. Fetch reference docs. Run all 4 topics in a batch.

## Priority 2: Diagram Quality Criterion

**Problem**: Reference doc scored 3.3/10 on diagrams — it uses a plain ASCII file tree, which judges rated low. This single criterion at 1x weight dragged reference from 1st to 3rd place on weighted score. Human docs often don't include Mermaid diagrams because they use screenshots/SVGs that don't appear in markdown.

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| A. Drop diagrams criterion | Removes unfair bias | Loses signal about AI diagram quality |
| B. Reduce weight to 0.5x | Keeps signal, reduces impact | Arbitrary weight adjustment |
| C. Reword to "Visual Aids" | Broadens to include ASCII trees, tables | Judges may still prefer Mermaid |
| D. Keep as-is, add length-normalized score | Diagrams is legit quality signal | Doesn't fix the comparison fairness |

**Recommendation**: Option C — rename to "Visual Aids" and reword rubric to explicitly value ASCII trees, formatted tables, and structured code examples alongside diagrams. Also add guidance: "Score based on whether visual elements aid understanding, not on whether a specific format (Mermaid, SVG) is used."

## Priority 3: Verbosity Control

**Problem**: Default Claude generated 32K chars vs reference's 6K — a 5.5x ratio. Techwriter cut this to 14K (still 2.3x reference). Judges scored default 5.7 on conciseness vs reference's 8.5.

**Options**:
- A. Add word/char limit to generation prompts (e.g., "target 3000 words max")
- B. Add a length penalty in the scoring formula
- C. Keep as-is — conciseness criterion already captures this
- D. Add reference doc length as a context hint ("the reference doc is ~1500 words")

**Recommendation**: Option C (keep as-is). The benchmark should measure what the model naturally produces. Verbosity is a real quality signal, and the conciseness criterion already captures it. Adding artificial length limits would test prompt-following, not documentation quality.

## Priority 4: Re-run with Fixed Qwen

**Problem**: Qwen judge failed due to invalid model ID. Now fixed to `qwen/qwen3-235b-a22b`.

**Action**: Re-run the existing topic to get 7/7 judge data. This also tests that the qwen fix works before the multi-topic batch.

**Note**: This changes Run 1 from 6/7 to 7/7. Record as Run 1b, not Run 2, since only the failed judge is re-run.

## Priority 5: Cross-Topic Aggregation

**Problem**: The analyzer currently handles a single topic per run. Multi-topic campaigns need aggregate statistics.

**Action**: After Priority 1, extend `analyze-results.ts` to accept multiple run directories and produce:
- Per-topic Borda rankings
- Cross-topic aggregate Borda (sum across topics)
- Friedman test across all topics × judges
- Win-rate matrix (how often each approach ranks 1st)

## Priority 6: Additional Approaches

After establishing a multi-topic baseline, consider adding:

| Approach | Model | Prompt | Purpose |
|----------|-------|--------|---------|
| `techwriter-sonnet` | Claude Sonnet 4.6 | generate-techwriter.md | Test if anti-slop rules work on smaller model |
| `gemini-pro` | Gemini 3 Pro | generate-techwriter.md | Test larger Gemini on same prompt |
| `grok` | Grok Code Fast | generate-techwriter.md | Cross-vendor comparison |
| `default-concise` | Claude (internal) | generate-default.md + length hint | Isolate verbosity from style |

**Note**: Adding approaches changes sample labels from A-D to A-F+. Judge template needs updating for >4 samples. Consider keeping 4-way and running separate campaigns for different approach sets.

## Execution Order

```
1. Fix diagram criterion wording (Priority 2) — no API cost
2. Re-run topic 1 with fixed qwen (Priority 4) — 1 judge call
3. Fetch 3 new reference docs (Priority 1) — no API cost
4. Run 4-topic batch (Priority 1) — 4 × (3 generations + 7 judges) = 40 API calls
5. Build cross-topic aggregator (Priority 5) — code only
6. Analyze full results, decide on Priority 6
```

## Open Questions

1. **Should we use the same generation prompt topic for all reference docs, or match prompts to reference content?** Current design: each topic has its own generation prompt that asks the model to write about the same subject as the reference doc. This is correct — the model writes about "Extension Anatomy" while the reference IS the Extension Anatomy doc.

2. **Should the reference doc always be from the topic's canonical source, or can we use any high-quality doc?** Recommendation: canonical source — this tests "can AI match the real thing" rather than "can AI match some other good doc."

3. **Should we add a human evaluation component?** LLM judges have known biases (prefer longer outputs, prefer their own style). A small human eval (3 engineers, 2 topics) would calibrate against judge bias. Low priority — do after multi-topic automated results.

4. **Should we test on non-technical documentation?** Current focus is developer docs. Could extend to: user guides, API references, tutorial walkthroughs. Each category may need different criteria weights.
