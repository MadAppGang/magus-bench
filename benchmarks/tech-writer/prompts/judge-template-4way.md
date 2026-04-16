You are a documentation quality expert conducting a blind evaluation of four technical documents.

The samples may cover different technical topics but are the same DOCUMENT TYPE — a conceptual overview of a plugin or extension mechanism.

EVALUATION RULES:
- Score each sample independently on each criterion. Do not compare samples to each other before scoring them individually.
- Do NOT use document length as a quality signal. A concise document can be superior to a verbose one. Evaluate quality per unit of content.
- Apply each criterion strictly as defined. Do not infer quality from writing style cues that might indicate human vs. AI authorship.
- Ignore formatting artifacts at the start or end of samples (pipeline artifacts, not part of the document content).
- Do NOT favor longer samples. Shorter, denser content can score higher than longer, padded content.

---

## SAMPLE A

{{SAMPLE_A}}

---

## SAMPLE B

{{SAMPLE_B}}

---

## SAMPLE C

{{SAMPLE_C}}

---

## SAMPLE D

{{SAMPLE_D}}

---

## Evaluation Instructions

Score each sample on each criterion from 1 (worst) to 10 (best). Use the full range — a score of 5 means mediocre, 7 means good, 9 means excellent.

### Criteria

1. **AI Slop Absence** (`slop`) — **2x weight**

   Evaluate at THREE levels:

   **Level 1 — Word-level slop** (each instance = -0.5 points):
   - Marketing superlatives: amazing, powerful, robust, revolutionary, seamless, cutting-edge, innovative, game-changing, world-class
   - Difficulty dismissers: simply, just, easy, obviously, of course, clearly, straightforward, trivial
   - Corporate jargon: leverage, utilize, streamline, facilitate, empower, unlock, accelerate, transform
   - Hedge phrases: "it is worth noting", "in order to", "due to the fact that", "might potentially"
   - AI preambles: "I'd be happy to", "Great question", "In today's world", "Let me explain", "Allow me to"
   - Simulated profundity: "At the heart of", "paradigm shift", "this is where things get interesting"

   **Level 2 — Structural slop** (each pattern = -1 point):
   - Uniform sentence lengths: AI text has suspiciously similar sentence lengths. Check if sentences vary in length or all cluster around the same word count.
   - Formulaic paragraphs: Every paragraph follows the same template (topic sentence → 2-3 supports → conclusion).
   - Symmetric lists: Every list has exactly 3 or 5 items. Natural writing uses 2, 4, 6, 7 items when appropriate.
   - Uniform section lengths: All sections approximately the same length signals machine generation.
   - Repetitive transition openers: >40% of paragraphs starting with transition words (However, Additionally, Furthermore, Moreover).

   **Level 3 — Pattern slop** (each pattern = -1 point):
   - Throat-clearing: "In this section, we will discuss...", "This document covers...", "Let's dive into...", "Let's explore..."
   - Hedging cascades: "It's important to note that... depending on your specific use case"
   - Formulaic conclusions: Final paragraphs that merely restate what was already covered
   - Meta-commentary: Sentences about the document rather than the actual subject matter

   A score of 10 means zero slop at ALL three levels. Score of 7 = minor word-level slop only. Score of 5 = structural patterns visible. Score of 3 = pervasive AI-generated feel.

2. **Writing Craft** (`writing_craft`) — **2x weight**

   Sentence variety (mix of short punchy sentences and longer explanatory ones — not all the same length). Voice clarity (active constructions, precise verbs, specific nouns rather than vague nominalizations). Structural confidence (assertions stated directly, not hedged). Applies equally to human and AI text — a badly written human document scores low, a well-crafted AI document scores high. Does not penalize correct technical vocabulary or domain-appropriate formality.

   Score 10 = reads like a skilled professional writer. Score 5 = functional but flat. Score 1 = confusing or hard to follow.

3. **Readability** (`readability`) — **1.5x weight**

   Short sentences (<25 words average), minimal passive voice (<10%), scannable paragraphs (<100 words), second-person address for instructions. Average sentence length under 25 words = good. Heavy passive voice or long sentences = low score.

4. **Document Structure** (`structure`) — **1.5x weight**

   Logical heading hierarchy (H1→H2→H3, no skipping), metadata header (title, description, audience), clear section ordering (overview→quickstart→details→reference), no skipped heading levels.

5. **Conciseness** (`conciseness`) — **1x weight**

   High information density. No filler paragraphs, no repetition, no throat-clearing intros. Every sentence adds new information.

6. **Internal Consistency** (`accuracy`) — **2x weight**

   Correct and internally consistent technical claims. No contradictions within the document, no hallucinated parameters or APIs, no claims that contradict each other across sections. Does NOT require you to verify against any external system — score based on internal coherence only. A document that is internally consistent scores well even if you cannot independently verify the technical claims.

7. **Progressive Disclosure** (`disclosure`) — **1x weight**

   Essential info first, details progressively deeper. Uses layered examples (basic→advanced), clear must-know vs nice-to-know separation.

8. **Diagram Quality** (`diagrams`) — **1x weight**

   Useful diagrams that aid understanding, correctly labeled, appropriate type for the content. Format-agnostic: Mermaid, SVG, PNG, ASCII all valid if the diagram serves its purpose. Score 1 if no diagrams present, or if diagrams are decorative rather than informative.

9. **Overall Quality** (`overall`) — **2x weight**

   Would you publish this documentation as-is? Professional, trustworthy, serves the reader.

---

## Output Format

First, analyze each sample in a `<thinking>` block. For each sample (A, B, C, D), note:
- Specific slop instances found (with quotes from the text)
- Writing craft observations (sentence variety, voice, precision)
- Readability assessment (sentence length, passive voice, scannability)
- Structure evaluation (heading hierarchy, metadata, section ordering)
- Conciseness check (information density, filler content)
- Internal consistency check (contradictions, hallucinated APIs, coherence across sections)
- Progressive disclosure evaluation (essential-first ordering, layered examples)
- Diagram assessment (presence, usefulness, labeling)
- Overall impression and relative ranking rationale

Then output your scores as a JSON object immediately after the closing `</thinking>` tag. No markdown fences around the JSON, no text after the JSON.

<thinking>
[Your detailed per-sample analysis here — be specific, cite examples from each sample]
</thinking>

{
  "scores": {
    "sample_a": {
      "slop": <1-10>,
      "writing_craft": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    },
    "sample_b": {
      "slop": <1-10>,
      "writing_craft": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    },
    "sample_c": {
      "slop": <1-10>,
      "writing_craft": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    },
    "sample_d": {
      "slop": <1-10>,
      "writing_craft": <1-10>,
      "readability": <1-10>,
      "structure": <1-10>,
      "conciseness": <1-10>,
      "accuracy": <1-10>,
      "disclosure": <1-10>,
      "diagrams": <1-10>,
      "overall": <1-10>
    }
  },
  "ranking": ["<best>", "<second>", "<third>", "<worst>"],
  "reasoning": "<2-3 sentences on ranking rationale>"
}

ranking must contain exactly the four labels ["A", "B", "C", "D"] in order from best to worst. Use the same labels you see above (Sample A, B, C, D).

Score honestly. Use the full 1-10 range. Do not default to giving all samples the same scores — meaningful differences between samples exist and your job is to find them.
