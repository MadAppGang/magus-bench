IMPORTANT: Output the complete documentation as your response text. Do NOT use any tools (Read, Write, Glob, Grep, Bash). Do NOT write to files. Your entire response should be the documentation in markdown format. Do NOT include any system messages, coaching suggestions, or session artifacts — start directly with the documentation content.

---

Write technical documentation about how skill injection works in the dev plugin's `/dev:implement` command.

The documentation should cover:

1. What skills are and how they're discovered (SKILL.md files, frontmatter parsing)
2. How the Skill tool invocation works — what happens when a skill is loaded
3. How content gets injected into the conversation context
4. How `/dev:implement` chains multiple skills (brainstorming → planning → execution)
5. The lifecycle of a skill invocation from trigger to completion

The target audience is a Claude Code plugin developer who wants to understand the skill system to build their own skills. They already know markdown, plugin structure (`plugin.json`, `skills/` directory), and Claude Code basics. Never explain those.

Include:
- Code examples showing skill file structure
- Diagrams illustrating the injection flow
- A quick-start section for creating a basic skill
- Reference information for the SKILL.md frontmatter schema

---

## WRITING RULES (follow exactly)

**BANNED WORDS & PHRASES** — never use:
- AI preambles: "I'd be happy to", "Certainly!", "Great question!", "Let me explain"
- Superlatives: amazing, revolutionary, powerful, robust, seamless, cutting-edge, innovative
- Dismissers: simply, easy, just, obviously, of course, clearly, straightforward
- Jargon: leverage, utilize, streamline, facilitate, empower, unlock, transform
- Filler: "it is worth noting", "in order to" (use "to"), "due to the fact that" (use "because")
- Throat-clearing: "In this section we will...", "This document covers...", "Let's dive into..."
- Hedging: "depending on your specific use case", "you might want to consider", "it's important to note"
- Metadiscourse navigation: "As we saw above", "Building on this", "The next section covers", "As mentioned earlier", "Recall that"
- Meta-transitions: "Now that we've covered X", "With that in mind", "Before we proceed"

**STYLE:**
- Active voice (>90%). Imperative for instructions. Passive OK when actor is irrelevant.
- Sentence average 15-20 words. Vary rhythm — mix 8-word punches with 30-word explanations. Never exceed 40. No 3+ consecutive sentences within ±5 words of each other.
- Transitions must state implications, contrasts, or decisions: "This means X" / "Unlike X, Y does Z" / "If A, use X. If B, use Y." Never use meta-transitions.
- At least 25% of sentences should NOT start with the subject. Use subordinate clauses showing causality ("X because Y") not coordination chains ("X and Y and Z").
- Paragraph length matches idea complexity: 1-2 sentences for definitions. 3-5 for mechanisms. 6+ only for counterintuitive content needing analogies.

**VOICE:**
- Own recommendations directly: "Use X" not "You might want to consider X". Only mention alternatives when you say when to choose them.
- Embed reasoning inline: "Use webhooks over polling because they eliminate redundant requests."
- Acknowledge genuine complexity honestly when it exists. Don't pretend everything is easy.
- Signal shared knowledge: "...the SKILL.md you created earlier", "same pattern as npm scripts."
- Never explain concepts the stated audience already knows.

**STRUCTURE:**
- Metadata header: title, one-line description, audience, prerequisites.
- Max 3 heading levels. Task-phrased headings: "Configure authentication" not "Configuration". Every heading works standalone as a scannable task statement.
- Progressive disclosure: overview → quick-start (5 min) → detailed walkthrough → reference → edge cases.
- `<details>` for edge cases. Skip-forward links for experienced readers.
- How-to sections: code example first, then explain. Reference sections: definition first.

**ANTI-AI PATTERNS:**
- Mix paragraph openers: code-first, assertion-first, conditional-first. Don't default to topic-sentence → supports → conclusion.
- Vary list lengths (2, 4, 6, 7 — not always 3 or 5). Vary section lengths (50-300 words).
- Vary information density. Every ~500 words, include one lighter element — a naming-confusion callout, a brief "gotcha", or an idiosyncratic analogy. Uniform density signals AI.
- No formulaic conclusions restating what was said. End sections with the last new piece of information or a forward-looking implication.

**CONTENT:**
- Include ≥1 Mermaid diagram with descriptive labels (not "Step 1").
- Code examples: complete, copy-pasteable, realistic values.
- Target 40%+ code-to-prose ratio. Every concept → code example within 2 paragraphs.
- Every sentence adds new information. No repetition.
