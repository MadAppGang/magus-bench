# Skill Injection System: Developer Guide

**Target audience:** Claude Code plugin developers building custom skills
**Scope:** How skills are discovered, loaded, and injected — with deep coverage of `/dev:implement` as a reference implementation

---

## Table of Contents

1. [What Is a Skill?](#what-is-a-skill)
2. [Skill Discovery](#skill-discovery)
3. [SKILL.md File Structure](#skillmd-file-structure)
4. [YAML Frontmatter Schema Reference](#yaml-frontmatter-schema-reference)
5. [How the Skill Tool Works](#how-the-skill-tool-works)
6. [Content Injection Into Context](#content-injection-into-context)
7. [Skill Chaining: How `/dev:implement` Works](#skill-chaining-how-devimplement-works)
8. [Full Lifecycle of a Skill Invocation](#full-lifecycle-of-a-skill-invocation)
9. [Quick-Start: Building Your First Skill](#quick-start-building-your-first-skill)
10. [Advanced Patterns](#advanced-patterns)
11. [Debugging Skills](#debugging-skills)

---

## What Is a Skill?

A **skill** is a Markdown file (`SKILL.md`) containing structured behavioral instructions that Claude loads on demand to govern how it approaches a specific task. Unlike commands (which define a slash command interface) or agents (which run in isolated subagent contexts), skills are **injected directly into the active conversation context** — they extend Claude's behavior in-place without spawning a new agent.

The key distinction:

| Concept | Mechanism | Context | Spawns Agent? |
|---------|-----------|---------|---------------|
| Command | `/dev:implement` → runs a `.md` file as a prompt | New or current session | No |
| Agent | `Task(subagent_type: "dev:developer")` | Isolated subagent window | Yes |
| **Skill** | `Skill("dev:implement")` → injects SKILL.md content | **Current conversation** | **No** |

Skills are the plugin system's answer to **behavioral composition**: you can stack multiple skills in one session, each contributing precise instructions for a phase of work.

---

## Skill Discovery

When you call `Skill("namespace:name")`, Claude Code resolves the skill file through a layered search:

```
Resolution Order (first match wins):
  1. Project-level:   {cwd}/skills/{namespace}/{name}/SKILL.md
  2. Plugin cache:    ~/.claude/plugins/cache/{namespace}/{name}/SKILL.md
  3. Global skills:   ~/.claude/skills/{namespace}/{name}/SKILL.md
```

The `namespace` corresponds to the plugin name (e.g., `dev`, `code-analysis`, `multimodel`). The `name` is the skill's identifier within that plugin.

### Plugin Skill Registration

Inside a plugin, skills are declared in `plugin.json`:

```json
{
  "name": "dev",
  "version": "1.39.0",
  "components": {
    "skills": [
      {
        "name": "implement",
        "path": "skills/implement/SKILL.md",
        "description": "Universal implementation command with optional real validation"
      },
      {
        "name": "brainstorm",
        "path": "skills/brainstorm/SKILL.md",
        "description": "Collaborative ideation and planning with multi-model exploration"
      }
    ]
  }
}
```

The `path` is relative to the plugin root. At install time, Claude Code copies the plugin to `~/.claude/plugins/cache/{plugin-name}/` and the skill files become available under `~/.claude/plugins/cache/{plugin-name}/skills/{skill-name}/SKILL.md`.

The `description` field in the plugin manifest is what surfaces in the `Skill` tool's list — it's Claude's first signal about when to invoke the skill. Make it precise and trigger-oriented.

---

## SKILL.md File Structure

Every skill file has two sections:

```markdown
---
name: implement
description: Universal implementation command with optional real validation
triggers:
  - "implement"
  - "build"
  - "create feature"
type: flexible
phases:
  - brainstorm
  - plan
  - execute
chains:
  - dev:brainstorm
  - dev:writing-plans
requires:
  - dev:brainstorm
---

# Skill Content

The actual behavioral instructions go here as Markdown prose.

Claude reads this content, treats it as authoritative guidance,
and follows it for the duration of the current task.

## Phase 1: ...

## Phase 2: ...
```

The **YAML frontmatter** (between `---` delimiters) provides metadata for the plugin system and for Claude. The **Markdown body** is the actual content that gets injected into context when the skill loads.

### Frontmatter vs Body: What Each Does

| Section | Parsed By | Purpose |
|---------|-----------|---------|
| YAML frontmatter | Claude Code plugin loader | Discovery, routing, chaining declarations |
| Markdown body | Claude (LLM) | Actual behavioral instructions followed at runtime |

The frontmatter is machine-readable metadata. The body is human-readable (but LLM-executed) instruction. Both matter.

---

## YAML Frontmatter Schema Reference

```yaml
---
# REQUIRED
name: string                    # Skill identifier (must match directory name)
description: string             # One-line trigger description shown in Skill tool list

# OPTIONAL — Routing & Discovery
triggers:                       # Keywords that suggest invoking this skill
  - string
type: rigid | flexible          # Rigid: follow exactly. Flexible: adapt principles.

# OPTIONAL — Chaining
chains:                         # Skills that SHOULD be invoked before this one
  - namespace:skill-name        # Claude will auto-invoke these if not already loaded
requires:                       # Skills that MUST be loaded first (hard dependency)
  - namespace:skill-name

# OPTIONAL — Metadata
phases:                         # Named phases this skill defines (documentation only)
  - string
tags:                           # Categorization tags
  - string
version: string                 # Skill version (semver)
---
```

### `type: rigid` vs `type: flexible`

This is the most important behavioral toggle in the frontmatter:

**`type: rigid`** — Claude must follow the skill's instructions exactly as written, step by step. Used for workflows where deviation causes real failures: TDD cycles, debugging protocols, release checklists. The skill body typically uses numbered steps and explicit "DO NOT SKIP" language.

**`type: flexible`** — Claude adapts the skill's principles to context. Used for guidelines, patterns, and heuristics where the spirit matters more than the letter: design patterns, code style, architectural guidance.

When in doubt, use `flexible`. Reserve `rigid` for processes where order, completeness, and precision are non-negotiable.

### `chains` vs `requires`

```
chains:  [dev:brainstorm, dev:writing-plans]
         ↑ Advisory: "if you haven't already, invoke these first"
         ↑ Claude will check if they're loaded; invoke if not

requires: [dev:brainstorm]
          ↑ Mandatory: refuse to proceed or warn if this skill wasn't invoked
```

`chains` drives **proactive skill loading** — when `/dev:implement` loads, it sees its `chains` list and invokes each in sequence before executing its own body. This is how multi-phase workflows are assembled from composable pieces.

`requires` is a runtime guard — Claude checks whether prerequisite skills were actually invoked in this session and surfaces a warning if not.

---

## How the Skill Tool Works

The `Skill` tool is a first-class Claude Code tool available in all sessions where at least one plugin is enabled. Its interface is minimal:

```typescript
Skill(skill_name: string): SkillContent
```

Where `skill_name` uses the `namespace:name` format: `"dev:implement"`, `"code-analysis:claudemem-search"`, `"multimodel:multi-model-validation"`.

### What Happens on Invocation

```
User message or command triggers skill invocation
           │
           ▼
   Skill("dev:implement")
           │
           ▼
┌─────────────────────────────┐
│   Claude Code Plugin Loader │
│                             │
│  1. Resolve skill path      │
│     namespace → plugin      │
│     name → skill dir        │
│                             │
│  2. Load SKILL.md           │
│     Parse YAML frontmatter  │
│     Extract Markdown body   │
│                             │
│  3. Return skill content    │
└─────────────────────────────┘
           │
           ▼
  Skill content returned to Claude
  as tool result (visible in context)
           │
           ▼
  Claude reads the skill body as
  authoritative instructions and
  begins following them
```

The returned content is a **tool result** — it appears in Claude's context window as a message with role `tool`, associated with the `Skill` tool call. Claude processes it the same way it processes any other context: it reads it, internalizes the instructions, and proceeds.

Critically, the skill content is **not a separate system prompt** — it's injected inline into the conversation as a tool result. This means:

1. It appears after all existing conversation history
2. Its instructions apply from that point forward
3. It can reference and respond to context already in the conversation
4. Multiple skills can be loaded sequentially, each building on the last

---

## Content Injection Into Context

Understanding the exact injection mechanism is essential for writing effective skills.

### The Context Window at Injection Time

When `Skill("dev:implement")` fires mid-conversation, the context looks like:

```
[System Prompt]
  └── Project CLAUDE.md
  └── Plugin-injected instructions
  └── SessionStart hook context

[Conversation History]
  ├── [Human] "Implement the user authentication feature"
  ├── [Assistant] "Using dev:implement to guide this..."
  │     └── Tool: Skill("dev:implement")         ← tool call
  │
  └── [Tool Result: dev:implement]               ← SKILL.md body injected HERE
        "# dev:implement skill
         ## Phase 1: Brainstorm...
         ..."
```

The skill body becomes **the most recent high-signal content** in context at the moment of injection. LLMs attend strongly to recent context, so skills injected just before work begins carry significant weight.

### Injection Scope

Skills inject **once per invocation**. If you call `Skill("dev:brainstorm")` twice in one session, the content appears twice in context. This is almost never what you want — skills should be invoked once per task.

The skill body does not auto-expire. Once injected, its instructions remain in context for the rest of the conversation unless the context window is compressed. For very long sessions, critical instructions may get compressed away — this is why rigid skills use `TodoWrite` to create persistent task items.

### Reinforcement Pattern

For long-running workflows, effective skills use `TodoWrite` as a persistence mechanism:

```markdown
## Initialization

When this skill loads, immediately call TodoWrite to create checklist items
for each phase. These persist through context compression.

TodoWrite items act as a durable contract — mark each complete as you finish.
```

This means the skill's structure lives in the task list, not just in context. Even if the skill's body gets compressed, the todos survive.

---

## Skill Chaining: How `/dev:implement` Works

`/dev:implement` is the canonical example of skill chaining in the Magus plugin ecosystem. It assembles a multi-phase workflow by loading prerequisite skills in sequence before executing its own logic.

### The Chain

```
User: /dev:implement "Add OAuth login"
         │
         ▼
  Command loads dev:implement skill
         │
         ▼
  Skill reads its `chains` frontmatter:
    chains:
      - dev:brainstorm      ← Phase 1
      - dev:writing-plans   ← Phase 2
         │
         ▼
  Skill("dev:brainstorm")   ← invoked first
  [Brainstorming phase executes...]
         │
         ▼
  Skill("dev:writing-plans") ← invoked second
  [Planning phase executes...]
         │
         ▼
  Skill("dev:implement") body ← execution phase
  [Implementation executes...]
```

### Phase 1: Brainstorming (`dev:brainstorm`)

When `dev:brainstorm` loads, it injects instructions for divergent exploration:

- Enumerate multiple approaches (typically 3-5)
- Use `mcp__plugin_code-analysis_claudemem__search` or `Grep` to understand existing patterns
- Consider edge cases, constraints, and non-obvious solutions
- Surface the recommended approach with rationale

The brainstorm phase is **exploratory** — Claude is instructed not to commit to an approach yet, just to map the solution space.

### Phase 2: Planning (`dev:writing-plans`)

After brainstorming, `dev:writing-plans` loads and injects planning instructions:

- Select the recommended approach from brainstorm output
- Break it into ordered, atomic implementation steps
- Identify files to create/modify
- Call `TodoWrite` to create a persistent task list
- Identify test strategy

The planning phase produces a **written implementation plan** in the conversation that both phases (and the user) can see.

### Phase 3: Execution (`dev:implement` body)

Finally, the `implement` skill's own body executes against the plan:

- Read each todo item
- Implement in order
- Mark complete as each step finishes
- Run tests after each logical chunk
- Surface any blocking issues immediately rather than continuing

### Why Chain Rather Than Merge?

Each skill is independently invocable. A developer who only wants the brainstorm phase can call `Skill("dev:brainstorm")` alone. The chaining mechanism lets `/dev:implement` assemble the full workflow while preserving each component's reusability.

This is analogous to Unix pipes: each tool does one thing well, and composition creates powerful workflows.

---

## Full Lifecycle of a Skill Invocation

Here is the complete lifecycle from user trigger to task completion, using `/dev:implement` as the reference:

```
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: TRIGGER                                                        │
│                                                                         │
│  User types: /dev:implement "Add rate limiting to the API"              │
│  Claude Code matches to dev plugin's implement command                  │
│  Command file loaded and passed to Claude as the prompt                 │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: SKILL RESOLUTION                                               │
│                                                                         │
│  Claude reads command content and encounters:                           │
│    "Use the Skill tool: Skill('dev:implement')"                         │
│                                                                         │
│  Alternatively, Claude identifies from available-skills context that    │
│  "dev:implement" matches the task and invokes it proactively            │
│                                                                         │
│  Claude Code plugin loader:                                             │
│    → Looks up "dev" namespace → finds plugin cache                      │
│    → Resolves "implement" → finds SKILL.md                              │
│    → Parses frontmatter: type=flexible, chains=[brainstorm, writing-plans]
│    → Returns Markdown body as tool result                               │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: CHAIN EXECUTION                                                │
│                                                                         │
│  Claude reads skill body, sees chaining instructions                    │
│  Announces: "Using dev:brainstorm to explore approaches"                │
│                                                                         │
│  Skill("dev:brainstorm") → brainstorm content injected                  │
│  Claude executes brainstorm phase:                                      │
│    - Searches codebase for existing patterns                            │
│    - Enumerates 3 approaches to rate limiting                           │
│    - Recommends token bucket approach with Redis                        │
│                                                                         │
│  Announces: "Using dev:writing-plans to formalize the plan"             │
│                                                                         │
│  Skill("dev:writing-plans") → planning content injected                 │
│  Claude executes planning phase:                                        │
│    - Selects recommended approach                                       │
│    - Breaks into 7 implementation steps                                 │
│    - TodoWrite([step1, step2, ..., step7])                              │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: IMPLEMENTATION EXECUTION                                       │
│                                                                         │
│  Claude follows implement skill body:                                   │
│    → Read TodoWrite list                                                │
│    → For each todo item:                                                │
│         Read relevant files                                             │
│         Write/edit code                                                 │
│         Run tests if applicable                                         │
│         Mark todo complete                                              │
│    → Final: run full test suite                                         │
│    → Surface any remaining issues                                       │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: COMPLETION                                                     │
│                                                                         │
│  All todos marked complete                                              │
│  Tests passing                                                          │
│  Claude surfaces summary: what was done, any caveats                   │
│                                                                         │
│  Skill instructions remain in context but execution is complete         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Quick-Start: Building Your First Skill

Let's build a `my-plugin:validate-api` skill that checks an API implementation against OpenAPI spec compliance.

### Step 1: Create the Directory Structure

```
plugins/my-plugin/
├── plugin.json
└── skills/
    └── validate-api/
        └── SKILL.md
```

### Step 2: Write the SKILL.md

```markdown
---
name: validate-api
description: Validate REST API implementation against OpenAPI spec compliance. Use when checking endpoints, request/response schemas, or HTTP method correctness.
triggers:
  - "validate api"
  - "check openapi"
  - "api compliance"
type: rigid
requires: []
chains: []
version: 1.0.0
tags:
  - api
  - validation
  - openapi
---

# validate-api Skill

You are performing a systematic OpenAPI compliance check. Follow these steps
exactly in order. Do not skip steps or reorder them.

## Step 1: Locate the OpenAPI Spec

Search for the spec file:
- `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`
- `docs/api/`, `api/`, or project root

If no spec file exists, stop and report: "No OpenAPI spec found. Create one
at openapi.yaml before running validation."

## Step 2: Inventory Defined Endpoints

Parse the spec and list every path + method combination:
```
GET  /users
POST /users
GET  /users/{id}
DELETE /users/{id}
```

Call TodoWrite to create a validation task for each endpoint.

## Step 3: Locate Implementation Files

For each endpoint, find its handler:
- Search for route registration patterns
- Identify the handler function/method
- Note the file:line location

## Step 4: Validate Each Endpoint

For each (spec endpoint → implementation) pair, check:

**Request validation:**
- [ ] Required query parameters are validated
- [ ] Request body schema matches spec (field names, types, required fields)
- [ ] Path parameters are extracted and validated

**Response validation:**
- [ ] HTTP status codes match spec definitions
- [ ] Response body structure matches spec schemas
- [ ] Error responses follow spec error schema

**HTTP semantics:**
- [ ] Correct HTTP method used
- [ ] Idempotency respected (PUT/DELETE are idempotent)
- [ ] 404 returned for unknown resources, not 400

Mark each todo complete as you finish it.

## Step 5: Report Results

Produce a compliance report:

```
## API Compliance Report

### ✅ Compliant Endpoints
- GET /users — fully compliant
- POST /users — fully compliant

### ⚠️ Partial Compliance
- GET /users/{id}
  - Missing: 404 response schema
  - Missing: validation of `id` format (should be UUID)

### ❌ Non-Compliant Endpoints
- DELETE /users/{id}
  - Returns 200 with body; spec requires 204 No Content
  - Missing authentication requirement

### Summary
- Total endpoints: 8
- Compliant: 5 (62.5%)
- Partial: 2 (25%)
- Non-compliant: 1 (12.5%)
```

Do not suggest fixes unless the user asks. Validation is the scope of this skill.
```

### Step 3: Register in plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "components": {
    "skills": [
      {
        "name": "validate-api",
        "path": "skills/validate-api/SKILL.md",
        "description": "Validate REST API implementation against OpenAPI spec compliance. Use when checking endpoints, request/response schemas, or HTTP method correctness."
      }
    ]
  }
}
```

**Important:** The `description` in `plugin.json` and the `description` in the frontmatter should be identical. The plugin.json description is shown in skill discovery tools; the frontmatter description is read by Claude when the skill loads. Consistent wording reinforces the signal.

### Step 4: Test the Skill

Install your plugin locally:

```bash
# In Claude Code session:
/plugin marketplace add /path/to/my-plugin

# Then invoke:
# Option 1: Direct invocation
Skill("my-plugin:validate-api")

# Option 2: Via a command that chains it
/my-plugin:validate-api
```

### Step 5: Validate Discovery

After installation, check that your skill appears:

```bash
# The skill should show in available-deferred-tools list
# and in Skill tool's available skills
```

---

## Advanced Patterns

### Pattern 1: Conditional Chaining

Skills can declare conditional chains using prose instructions in the body rather than frontmatter:

```markdown
## Initialization

Before proceeding, check if this is a new feature or a bug fix:
- **New feature:** invoke Skill("dev:brainstorm") first
- **Bug fix:** invoke Skill("dev:systematic-debugging") first
- **Refactor:** proceed directly to planning

Ask the user if the context is unclear.
```

This gives Claude judgment about which chain path to take, rather than always loading all chains.

### Pattern 2: TodoWrite as Skill State

For multi-phase skills, use `TodoWrite` at initialization to create a persistent task structure:

```markdown
## Skill Initialization

Immediately on loading this skill, call TodoWrite with these items:

1. "Phase 1: Understand current behavior [validate-api]"
2. "Phase 2: Locate OpenAPI spec [validate-api]"
3. "Phase 3: Map endpoints to handlers [validate-api]"
4. "Phase 4: Validate each endpoint [validate-api]"
5. "Phase 5: Generate compliance report [validate-api]"

Tag each item with `[validate-api]` to distinguish from other active tasks.
Mark each complete as you finish it.
```

The `[skill-name]` tag allows multiple skills to have active todos simultaneously without collision.

### Pattern 3: Skill Composition Without Chaining

Sometimes you want to manually compose skills without declaring chains. This is useful for skills that should remain independent but work well together:

```markdown
## When to Compose

This skill works well with:
- `code-analysis:claudemem-search` for semantic codebase exploration
- `dev:systematic-debugging` if validation surfaces unexpected behavior

Invoke these manually if needed — they are not auto-chained.
```

This documents composition opportunities without forcing them.

### Pattern 4: Guard Rails with `requires`

Use `requires` to enforce prerequisite ordering:

```markdown
---
name: deploy
requires:
  - dev:test-coverage
  - dev:audit
---

# deploy Skill

IMPORTANT: This skill requires test coverage analysis and security audit
to have been completed in this session. If they have not been run, stop
immediately and run them first:

  Skill("dev:test-coverage")
  Skill("dev:audit")

Do not proceed with deployment until both prerequisites are complete.
```

The `requires` frontmatter is advisory metadata — Claude reads the body's explicit instructions to enforce the guard. The frontmatter is a machine-readable declaration of intent.

### Pattern 5: Skill Families

Group related skills under a common namespace with a hierarchy:

```
skills/
├── validate/
│   ├── SKILL.md          ← "validate" — dispatcher skill
│   ├── validate-api/
│   │   └── SKILL.md      ← "validate-api" — specific validator
│   └── validate-db/
│       └── SKILL.md      ← "validate-db" — specific validator
```

The dispatcher skill (`validate`) reads the user's intent and routes to the appropriate specific skill. This is the pattern used by `code-analysis:investigate` which auto-routes to `developer-detective`, `tester-detective`, `debugger-detective`, etc.

---

## Debugging Skills

### Problem: Skill Not Found

```
Error: Skill "my-plugin:validate-api" not found
```

**Diagnosis checklist:**

1. Is the plugin installed? Check `~/.claude/plugins/cache/my-plugin/`
2. Is the path in `plugin.json` correct? The path is relative to plugin root.
3. Does the directory name match the `name` field in frontmatter?
4. Was the plugin version bumped after adding the skill? Claude Code caches manifests at install time.

```bash
# Force reinstall to pick up skill changes
/plugin uninstall my-plugin
/plugin marketplace add /path/to/my-plugin
```

### Problem: Skill Loads But Instructions Not Followed

This is almost always a **skill body writing problem**, not a system problem. Common causes:

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Claude skips steps | Unclear step boundaries | Use numbered lists, not prose |
| Claude deviates from process | `type: flexible` on a rigid workflow | Change to `type: rigid` |
| Claude stops mid-skill | Ambiguous continuation instructions | Add explicit "continue to next step" transitions |
| Chain skills not invoked | Missing `chains` frontmatter | Add to frontmatter AND add explicit invocation in body |
| Instructions forgotten mid-session | Context compression | Use TodoWrite for persistent state |

### Problem: Chain Skills Invoked in Wrong Order

The `chains` array is **ordered** — skills are loaded in array order. But Claude can also reorder based on context signals. To enforce order:

```markdown
## CRITICAL: Execution Order

You MUST invoke skills in this exact order. Do not skip or reorder:

1. First: Skill("dev:brainstorm") — exploration phase
   → Wait for brainstorm output before continuing
2. Second: Skill("dev:writing-plans") — planning phase
   → Wait for plan and TodoWrite before continuing
3. Third: Begin implementation per this skill's body

DO NOT begin step N until step N-1 is fully complete.
```

Explicit sequential ordering language in the skill body is more reliable than relying on the frontmatter `chains` ordering alone.

### Problem: Skill Works Once, Breaks in Long Sessions

Context compression is removing skill instructions. Solutions:

1. **TodoWrite reinforcement** — create todos that act as persistent reminders
2. **Periodic re-invocation** — some skills explicitly instruct re-invocation if they detect drift
3. **Critical instructions at the end of the body** — LLMs attend more to recent content; put key rules last, not first

```markdown
## Reminder (Read Last)

Even if earlier content was compressed, remember:
- Always run tests before marking a todo complete
- Never skip the compliance report
- These rules are non-negotiable
```

---

## Reference: Key Differences from Commands and Agents

| Feature | Command | Skill | Agent |
|---------|---------|-------|-------|
| **Invocation** | `/namespace:name` | `Skill("namespace:name")` | `Task(subagent_type: "namespace:name")` |
| **Context** | Current session | Current session | Isolated subprocess |
| **State sharing** | Shared | Shared | Isolated |
| **Parallelism** | No | No | Yes (`run_in_background: true`) |
| **Can use tools** | Via Claude | Via Claude | Via isolated Claude |
| **File format** | Any `.md` | `SKILL.md` | `AGENT.md` |
| **Frontmatter** | YAML | YAML | YAML |
| **Chain support** | Via skill invocation | Via `chains` frontmatter | No |
| **Best for** | Slash command interface | Behavioral guidance | Isolated parallel work |

### When to Build a Skill vs an Agent

Build a **skill** when:
- The task needs access to current conversation context
- You want behavior that affects the active Claude session
- The workflow is sequential (not parallel)
- You want composable building blocks that users can invoke à la carte

Build an **agent** when:
- The task is independent from current context
- Multiple instances can run in parallel
- The task is long-running and shouldn't block the main session
- You want isolation (agent's tool calls don't appear in main session)

Build a **command** when:
- You need a user-facing slash command interface
- The command is primarily an invocation point for skills and agents
- You want to expose functionality in the command palette

In practice, the most powerful patterns combine all three: a **command** (`/dev:implement`) invokes **skills** (`dev:brainstorm`, `dev:implement`) which then delegate heavy work to **agents** (`dev:developer`).

---

*This document is part of the Magus plugin developer documentation. For release process, see `RELEASE_PROCESS.md`. For the skill writing style guide, see `plugins/dev/skills/` for examples.*