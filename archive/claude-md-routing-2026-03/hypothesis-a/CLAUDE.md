# Project Context for Claude Code

## CRITICAL RULES

- **NEVER use `pkill` or broad process-killing commands** (like `pkill -f "claudeup"` or `pkill -f "claude"`). This kills all Claude CLI sessions running on the machine. Instead, ask the user to restart applications manually or close specific windows.
- **Do not use hardcoded paths** in code, docs, comments, or any other files.

## Project Overview

**Repository:** Magus
**Purpose:** Professional plugin marketplace for Claude Code
**Owner:** Jack Rudenko (i@madappgang.com) @ MadAppGang
**License:** MIT

## Plugins (12 published)

| Plugin | Version | Purpose |
|--------|---------|---------|
| **Code Analysis** | v4.0.2 | Codebase investigation with claudemem MCP, 13 skills |
| **Multimodel** | v2.6.2 | Multi-model collaboration and orchestration |
| **Agent Development** | v1.5.5 | Create Claude Code agents and plugins |
| **SEO** | v1.6.5 | SEO analysis and optimization with AUTO GATEs |
| **Video Editing** | v1.1.1 | FFmpeg, Whisper, Final Cut Pro integration |
| **Nanobanana** | v2.3.1 | AI image generation with Gemini 3 Pro Image |
| **Conductor** | v2.1.1 | Context-Driven Development with TDD and Git Notes |
| **Dev** | v1.39.0 | Universal dev assistant with workflow enforcement, 47 skills |
| **Designer** | v0.2.0 | UI design validation with pixel-diff comparison, 6 skills |
| **Browser Use** | v1.0.0 | Full-platform browser automation, 18 MCP tools, 5 skills |
| **Statusline** | v1.4.1 | Colorful statusline with worktree awareness |
| **Terminal** | v2.1.0 | Intent-level terminal: run, watch, observe, repl, tui + ht-mcp/tmux-mcp |

**Claudish CLI**: `npm install -g claudish` - Run Claude with OpenRouter models ([separate repo](https://github.com/MadAppGang/claudish))

## Directory Structure

```
claude-code/
├── CLAUDE.md                  # This file
├── README.md                  # Main documentation
├── RELEASE_PROCESS.md         # Plugin release process guide
├── .env.example               # Environment template
├── .claude-plugin/
│   └── marketplace.json       # Marketplace plugin listing
├── plugins/                   # All plugins (12 published, 3 unlisted)
│   ├── code-analysis/         # v4.0.2 — 13 skills, 1 agent, claudemem MCP
│   ├── multimodel/            # v2.6.2 — 15 skills
│   ├── agentdev/              # v1.5.5 — 5 skills
│   ├── seo/                   # v1.6.5 — 12 skills
│   ├── video-editing/         # v1.1.1 — 3 skills
│   ├── nanobanana/            # v2.3.1 — 2 skills
│   ├── conductor/             # v2.1.1 — 6 skills
│   ├── dev/                   # v1.39.0 — 47 skills, workflow enforcement
│   ├── designer/              # v0.2.0 — 6 skills, pixel-diff design validation
│   ├── browser-use/           # v1.0.0 — 5 skills, 18 MCP tools
│   ├── statusline/            # v1.4.1 — 1 skill
│   ├── terminal/              # v2.1.0 — 2 skills, ht-mcp + tmux-mcp
│   └── (go, instantly, autopilot — unlisted)
├── autotest/                  # E2E test framework
│   ├── framework/             # Shared runner, parsers (Bun/TS)
│   ├── coaching/              # Coaching hook tests
│   ├── designer/              # Designer plugin tests (12 cases)
│   ├── subagents/             # Agent delegation tests
│   ├── team/                  # Multi-model /team tests
│   ├── skills/                # Skill routing tests
│   ├── terminal/              # Terminal plugin tests (9 cases)
│   └── worktree/              # Worktree tests
├── tools/                     # Standalone tools
│   ├── claudeup/              # TUI installer (npm package, v3.5.0)
│   ├── claudeup-core/         # Core library
│   └── claudeup-gui/          # GUI version
├── skills/                    # Project-level skills
│   └── release/SKILL.md
├── ai-docs/                   # Technical documentation
└── docs/                      # User documentation
```

## Important Files

- `.claude-plugin/marketplace.json` — Marketplace listing (**update when releasing!**)
- `plugins/{name}/plugin.json` — Plugin manifest (version, components, MCP servers)
- `plugins/{name}/.mcp.json` — MCP server config (if plugin has MCP servers)
- `RELEASE_PROCESS.md` / `skills/release/SKILL.md` — Release process docs
- `autotest/framework/runner-base.sh` — E2E test runner entry point

## E2E Testing

```bash
# Run a test suite (all use autotest/framework/ shared runner)
./autotest/terminal/run.sh --model claude-sonnet-4-6 --parallel 3
./autotest/coaching/run.sh --model claude-sonnet-4-6
./autotest/designer/run.sh --model claude-sonnet-4-6
./autotest/subagents/run.sh --model or@x-ai/grok-code-fast-1

# Run specific test cases
./autotest/terminal/run.sh --model claude-sonnet-4-6 --cases environment-inspection-08

# Analyze existing results
bun autotest/terminal/analyze-results.ts autotest/terminal/results/<run-dir>
```

## Environment Variables

**Required:**
```bash
APIDOG_API_TOKEN=your-personal-token
FIGMA_ACCESS_TOKEN=your-personal-token
```

**Optional:**
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=your-token
CHROME_EXECUTABLE_PATH=/path/to/chrome
CODEX_API_KEY=your-codex-key
```

## Claude Code Plugin Requirements

**Plugin System Format:**
- Plugin manifest: `.claude-plugin/plugin.json` (must be in this location)
- Settings format: `enabledPlugins` must be object with boolean values
- Component directories: `agents/`, `commands/`, `skills/` at plugin root
- MCP servers: `.mcp.json` at plugin root (referenced as `"mcpServers": "./.mcp.json"` in plugin.json)
- Environment variables: Use `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths

**Quick Reference:**
```bash
# Install marketplace
/plugin marketplace add MadAppGang/magus

# Local development
/plugin marketplace add /path/to/claude-code
```

**Enable in `.claude/settings.json`:**
```json
{
  "enabledPlugins": {
    "code-analysis@magus": true,
    "dev@magus": true,
    "terminal@magus": true
  }
}
```

## AGENTS — use `Task` tool with `subagent_type` field

IMPORTANT: When a task matches an agent below, delegate IMMEDIATELY via the Task tool. Do NOT attempt to handle it inline. Do NOT read files or investigate before delegating — let the agent handle the full task in its own context window.

| Agent | Use for | Do NOT use for |
|-------|---------|----------------|
| `dev:researcher` | Web research, tech comparisons, best practices, multi-source reports | Local code reading, implementation |
| `dev:developer` | Multi-file implementation, creating modules, building features with tests | Research, read-only analysis |
| `code-analysis:detective` | Read-only codebase investigation, tracing, architecture understanding | Bug fixing, writing new code |
| `dev:debugger` | Runtime errors, root cause analysis, stack traces, failing tests | Architecture questions, feature requests |
| `dev:architect` | System design, trade-off analysis, planning major changes | Writing code, debugging |
| `agentdev:reviewer` | Agent/plugin quality review | Implementation, research |
| `dev:reviewer` | Code review, PR review, quality checks | Implementation, research |

Do NOT handle research, debugging, or investigation tasks inline. Always delegate these to the matching agent above.

## SKILLS — use `Skill` tool directly (NEVER use Task tool for skills)

Skills use the `Skill` tool, NOT the `Task` tool. Do NOT create a Task for any of these — invoke them directly with the Skill tool.

| Skill | When to use |
|-------|-------------|
| `code-analysis:claudemem-search` | Before using `claudemem` commands, semantic code search, AST analysis |
| `code-analysis:claudemem-orchestration` | Parallel claudemem across agents |
| `code-analysis:architect-detective` | Architecture-focused claudemem usage with PageRank |
| `code-analysis:deep-analysis` | Comprehensive multi-perspective codebase investigation |
| `dev:db-branching` | Worktree creation with schema changes needing DB isolation |
| `terminal:terminal-interaction` | TTY, interactive output, long-running process, database shell |
| `terminal:tui-navigation-patterns` | Navigating TUI apps (vim, htop, lazygit, k9s), key sequences |
| `code-analysis:claudish-usage` | Before ANY `claudish` command — bare model names, no prefixes |

## Release Process

**Version History:** See [CHANGELOG.md](./CHANGELOG.md) | **Detailed Notes:** See [RELEASES.md](./RELEASES.md)

**Git tag format:** `plugins/{plugin-name}/vX.Y.Z`

**Plugin Release Checklist (ALL 3 REQUIRED):**
1. **Plugin version** - `plugins/{name}/plugin.json` -> `"version": "X.Y.Z"`
2. **Marketplace version** - `.claude-plugin/marketplace.json` -> plugin entry `"version": "X.Y.Z"`
3. **Git tag** - `git tag -a plugins/{name}/vX.Y.Z -m "Release message"` -> push with `--tags`

Missing any of these will cause claudeup to not see the update!

**Claudeup Release Process:**
1. Update `tools/claudeup/package.json` -> `"version": "X.Y.Z"`
2. Commit: `git commit -m "feat(claudeup): vX.Y.Z - Description"`
3. Tag: `git tag -a tools/claudeup/vX.Y.Z -m "Release message"`
4. Push: `git push origin main --tags`

The workflow `.github/workflows/claudeup-release.yml` triggers on `tools/claudeup/v*` tags (builds with pnpm, publishes to npm via OIDC).

---

**Maintained by:** Jack Rudenko @ MadAppGang
**Last Updated:** March 3, 2026
