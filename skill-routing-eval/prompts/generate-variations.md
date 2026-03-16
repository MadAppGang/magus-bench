You are a test case generator for a Claude Code skill routing system.

The system under test is Claude Code with a plugin ecosystem. Claude must:
- Use the `Skill` tool (not `Task`) when invoking skills
- Use the `Task` tool (not `Skill`) when delegating to subagents
- Route tasks to the correct agent or handle them directly without delegation

Given this seed test case:
- ID: {{seed_id}}
- Prompt: "{{seed_prompt}}"
- Expected outcome: {{expected_outcome}}
- Category: {{category}}
- Tags: {{tags}}

Generate {{count}} natural language variations that should produce the **same expected outcome**.

## Rules

1. **Vary the phrasing naturally** — use different words, sentence structures, and styles
2. **Vary the specificity** — some prompts vague, some precise, some contextual
3. **Vary the formality** — casual requests, professional instructions, terse commands
4. **Include at least 2 edge cases** — boundary conditions, unusual phrasing, minimal context
5. **Include at least 1 adversarial variant** — a prompt that might plausibly trick wrong routing
6. **Each variation must be a realistic user prompt** — something a real developer would type
7. **Preserve expected outcome** — every variation must still route to `{{expected_outcome}}`
8. **No near-duplicates** — each variation must be meaningfully different from the others

## Category Definitions

- `explicit-skill`: User names a specific skill by its full identifier (e.g., `code-analysis:claudemem-search`)
- `implicit-skill`: User describes a need that maps to a skill without naming it
- `explicit`: User explicitly names a specific agent (e.g., `dev:researcher`)
- `passive-routing`: Complex task where CLAUDE.md routing table should trigger delegation
- `implicit-delegation`: Complex task that implicitly requires a subagent
- `hinted-delegation`: User hints at using a subagent without naming one
- `direct`: Simple task that should be handled without any skill or agent
- `no-skill`: Task that must NOT invoke any skill
- `agent-vs-skill`: Tests that skills go through `Skill` tool, not `Task` tool
- `mixed-routing`: Task requiring both a skill and an agent

## Variant Types

- `rephrased`: Same intent, different words/structure
- `edge_case`: Boundary condition or minimal/maximal phrasing
- `adversarial`: Designed to plausibly trigger incorrect routing
- `context_shift`: Same task but framed in a different project/scenario context
- `terse`: Very short, command-like prompt
- `verbose`: Over-explained, highly contextual prompt

## Output Format

Return a JSON array. No prose before or after — only the JSON.

```json
[
  {
    "id": "{{seed_id}}-var-01",
    "prompt": "...",
    "expected_outcome": "{{expected_outcome}}",
    "category": "{{category}}",
    "variant_type": "rephrased|edge_case|adversarial|context_shift|terse|verbose",
    "difficulty": "easy|medium|hard",
    "rationale": "one sentence explaining why this variant tests what it tests"
  }
]
```

Difficulty guidelines:
- `easy`: Phrasing leaves no ambiguity about the correct routing
- `medium`: Requires some inference but the routing is deterministic
- `hard`: Genuinely ambiguous; tests the routing logic under uncertainty
