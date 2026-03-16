# Research Findings: Promptfoo — Open-Source LLM Evaluation Framework

**Researcher**: Explorer 1
**Date**: 2026-03-14
**Model Strategy**: native (local + direct HTTP fetch)
**Sources fetched**: 8 official promptfoo.dev documentation pages + local codebase review
**Questions answered**: 7/7

---

## Executive Summary

Promptfoo is a mature, open-source CLI and library for evaluating LLMs via declarative YAML test suites. It supports 60+ providers (including Anthropic Claude and Claude Agent SDK natively), a rich assertion system spanning deterministic rules to LLM-graded rubrics, multi-turn conversations, tool-call validation, and automated red-teaming. It has direct, first-class support for the Claude Agent SDK, making it meaningfully applicable to our plugin/skill evaluation context — but significant integration work would still be required to map our claudish-based workflow into its provider model.

**Notable 2026 update**: Promptfoo has announced it is joining OpenAI (visible on every page header as of the docs fetch on 2026-03-13).

---

## Finding 1: Core Architecture — Declarative YAML Driving a Prompt × Provider × Test Matrix

**Summary**: Promptfoo's central abstraction is a `promptfooconfig.yaml` file that defines prompts, providers, and test cases. The framework executes a full cross-product matrix (every prompt × every provider × every test case) and collects outputs for assertion-based or manual review.

**Evidence**:

The config file has four top-level keys:

```yaml
# promptfooconfig.yaml
prompts:
  - file://prompt1.txt            # path to prompt template
  - 'Translate {{input}} to {{language}}'  # inline with Nunjucks variables

providers:
  - openai:gpt-5-mini
  - anthropic:messages:claude-opus-4-6
  - file://custom_provider.py    # arbitrary Python/JS/shell provider

defaultTest:
  assert:
    - type: llm-rubric
      value: "does not describe self as an AI"

tests:
  - vars:
      language: French
      input: Hello world
    assert:
      - type: contains
        value: Bonjour
  - vars:
      language: German
      input: How's it going?
    assert:
      - type: similar
        value: "wie geht's"
        threshold: 0.6
```

Key architectural properties:
- **Nunjucks templating**: `{{variable_name}}` syntax for variable injection into prompts
- **Matrix execution**: Every `prompt × provider × test` combination runs automatically
- **`defaultTest`**: Set assertions or vars that apply to all tests, reducing repetition
- **YAML anchors/refs**: Reuse assertion blocks via `$ref: '#/assertionTemplates/myCheck'`
- **External file loading**: Prompts, providers, vars, and tests can all point to external files or glob patterns
- **Output formats**: Results saved as JSON, YAML, CSV, HTML, or viewed in an interactive web UI
- **CI/CD integration**: Runs as a CLI (`promptfoo eval`), suitable for GitHub Actions etc.

**Sources**:
- [Configuration Overview](https://www.promptfoo.dev/docs/configuration/guide/) — Quality: High, Date: 2026-03-13
- [Getting Started](https://www.promptfoo.dev/docs/getting-started/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: Yes

---

## Finding 2: Test Case Format — vars, assert, options, metadata

**Summary**: Test cases are YAML objects with `vars` (template inputs), `assert` (assertions), `options` (per-test overrides), and `metadata`. The format is flexible: arrays of vars automatically generate combinatorial cases, and vars can be loaded from Python/JS files or even PDFs.

**Evidence**:

```yaml
tests:
  # Basic test with vars and assertions
  - vars:
      language: French
      input: Hello world
    assert:
      - type: contains
        value: Bonjour
      - type: javascript
        value: "output.length < 200"

  # Weighted assertions with threshold
  - threshold: 0.7   # overall test passes if weighted score > 0.7
    vars:
      question: What is the capital of France?
    assert:
      - type: equals
        value: Paris
        weight: 2        # this assertion counts twice
      - type: llm-rubric
        value: "Answer is factually correct"
        weight: 1

  # Combinatorial: runs all language x input combinations
  - vars:
      language: [French, German, Spanish]
      input: ['Hello world', 'Good morning']

  # Multi-turn: reference previous outputs
  - vars:
      question: Who founded Facebook?
    options:
      storeOutputAs: founderName      # save output as variable for next turn
  - vars:
      question: "Tell me more about {{founderName}}"

  # Dynamic vars from Python
  - vars:
      context: file://fetch_from_vector_db.py
```

Key test-case features:
- `options.storeOutputAs`: Capture model output as a variable for downstream test cases (critical for multi-turn flows)
- `metadata.conversationId`: Group tests into separate conversation threads
- `description`: Human-readable label for the test in the web UI
- `threshold`: Fractional pass threshold when using weighted assertions
- External test files: `tests: file://tests/*.yaml` or CSV, JSONL, Google Sheets

**Sources**:
- [Configuration Overview](https://www.promptfoo.dev/docs/configuration/guide/) — Quality: High, Date: 2026-03-13
- [Assertions and Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: Yes

---

## Finding 3: Assertion Types — Deterministic, Model-Graded, and Custom

**Summary**: Promptfoo has two categories of assertions: (1) deterministic programmatic checks that run without calling an LLM, and (2) model-assisted checks that use embeddings, classifiers, or an LLM-as-judge. Every type can be negated with `not-` prefix. Custom logic can be injected via JavaScript, Python, or webhook.

**Evidence**:

### Deterministic Assertions (no LLM call)

| Type | Passes when |
|------|-------------|
| `equals` | Output exactly matches value |
| `contains` / `icontains` | Output contains substring (case-insensitive variant) |
| `contains-any` / `contains-all` | Output contains any/all of a list |
| `regex` | Output matches regular expression |
| `starts-with` | Output starts with string |
| `is-json` / `contains-json` | Output is (or contains) valid JSON, optionally validates against JSON schema |
| `is-sql` / `contains-sql` | Output is valid SQL |
| `is-xml` / `contains-xml` | Output is valid XML |
| `is-html` | Output is valid HTML |
| `is-refusal` | Model refused the request |
| `javascript` | Custom JS function validates output: `value: "output.includes('foo') && output.length < 500"` |
| `python` | Custom Python function validates output |
| `webhook` | POST to external URL, passes if `{pass: true}` returned |
| `rouge-n` | Rouge-N score >= threshold (default 0.75) |
| `bleu` / `gleu` / `meteor` | NLP similarity scores |
| `levenshtein` | Edit distance below threshold |
| `latency` | Response latency < N milliseconds |
| `cost` | Token cost < N USD |
| `is-valid-openai-tools-call` | All tool calls match tools JSON schema |
| `trace-span-count` | Count spans in trace matching patterns |
| `trace-span-duration` | Check span durations |
| `guardrails` | Output does not contain harmful content |

### Model-Assisted Assertions (LLM or ML call)

| Type | Method |
|------|--------|
| `similar` | Embeddings + cosine similarity >= threshold |
| `classifier` | Run output through ML classifier |
| `llm-rubric` | LLM grades output against a rubric string |
| `g-eval` | Chain-of-thought evaluation via G-Eval framework |
| `answer-relevance` | LLM checks if output answers the query |
| `context-faithfulness` | LLM verifies output uses provided context |
| `context-recall` | Checks ground truth appears in context |
| `factuality` | OpenAI evals Factuality method |
| `model-graded-closedqa` | OpenAI evals ClosedQA method |
| `select-best` | Compare multiple outputs and pick best |
| `max-score` | Select output with highest aggregate score |

### Assertion Sets
```yaml
assert:
  - type: assert-set
    threshold: 0.5   # at least 50% of sub-assertions must pass
    assert:
      - type: cost
        threshold: 0.001
      - type: latency
        threshold: 200
```

**Sources**:
- [Assertions and Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: No (but first-party official docs)

---

## Finding 4: Multi-Model Comparison — Native Matrix View

**Summary**: Multi-model comparison is a first-class feature. Listing multiple providers in `providers:` runs every test against every model, and the web UI renders a side-by-side matrix. Cost and latency assertions can enforce SLA constraints per model.

**Evidence**:

```yaml
providers:
  - openai:gpt-5
  - openai:gpt-5-mini
  - anthropic:messages:claude-opus-4-6
  - google:gemini-2.5-pro

defaultTest:
  assert:
    - type: cost
      threshold: 0.002      # USD, per inference
    - type: latency
      threshold: 3000        # milliseconds
```

The web UI (`promptfoo view`) renders outputs as a matrix: rows = test cases, columns = (prompt, provider) combinations. This enables rapid visual diff of model behaviors.

Provider syntax for 60+ providers:
```
openai:gpt-5-mini
anthropic:messages:claude-opus-4-6
google:gemini-2.5-pro
vertex:gemini-2.5-pro
bedrock:us.anthropic.claude-opus-4-6-v1:0
ollama:chat:llama3.3
openrouter:mistral/7b-instruct
exec: python chain.py        # custom shell provider
file://custom_provider.js    # custom JS provider
file://custom_provider.py    # custom Python provider
http://localhost:8080/v1/...  # generic HTTP endpoint
```

For our use case: `claudish` could be wrapped as a `exec:` or `file://` custom provider to route prompts through the existing CLI infrastructure.

**Sources**:
- [LLM Providers](https://www.promptfoo.dev/docs/providers/) — Quality: High, Date: 2026-03-13
- [Getting Started](https://www.promptfoo.dev/docs/getting-started/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: Yes

---

## Finding 5: Agent Testing — Tool Calls, Multi-Turn, Claude Agent SDK

**Summary**: Promptfoo has strong first-class support for agent evaluation: tool call validation via `is-valid-openai-tools-call`, multi-turn conversations via `_conversation` variable and `storeOutputAs`, and a dedicated `anthropic:claude-agent-sdk` provider that runs Claude Code/Agent SDK with configurable tool access, working directories, and MCP server connections.

**Evidence**:

### Tool Call Validation
```yaml
providers:
  - id: openai:gpt-4
    config:
      tools:
        - type: function
          function:
            name: get_weather
            description: Get current weather
            parameters:
              type: object
              properties:
                location: {type: string}
              required: [location]
      tool_choice: required    # force tool use

tests:
  - vars:
      question: What is the weather in Paris?
    assert:
      - type: is-valid-openai-tools-call   # validates tool schema compliance
      - type: javascript
        value: "JSON.parse(output).tool_calls[0].function.name === 'get_weather'"
```

Promptfoo auto-converts OpenAI tool format to Anthropic/Bedrock/Google native formats, enabling cross-provider tool-call comparison.

### Multi-Turn Conversations
```yaml
tests:
  # Using _conversation (sequential turns, single-threaded)
  - vars:
      question: Who founded Facebook?
  - vars:
      question: Where does he live?     # uses _conversation context
  - vars:
      question: Which state is that in?

  # Using storeOutputAs (explicit variable threading)
  - vars:
      message: "What's your favorite fruit? Output one word only"
    options:
      storeOutputAs: favoriteFruit
  - vars:
      message: "Why do you like {{favoriteFruit}} so much?"
```

Conversation isolation is managed via `metadata.conversationId`. Scenarios automatically get independent conversation histories.

### Claude Agent SDK Provider (Critical for Our Use Case)
```yaml
providers:
  - id: anthropic:claude-agent-sdk    # also: anthropic:claude-code
    config:
      working_dir: ./my-project       # file system access
      model: claude-opus-4-6
      max_turns: 10
      permission_mode: acceptEdits    # allow file writes without confirmation
      append_allowed_tools:
        - Write
        - Edit
        - MultiEdit
        - Bash
      mcp:                            # MCP server connections
        servers:
          - name: my-server
            command: npx my-mcp-server
      append_system_prompt: |
        You have access to the dev plugin. Use /dev:implement to...
      custom_allowed_tools:           # replaces default tool set
        - Read
        - Bash
        - Write
```

This provider runs the actual Claude Agent SDK (previously Claude Code SDK), meaning it can:
- Access the filesystem in a configurable working directory
- Execute bash commands
- Call MCP servers
- Use Claude's native plugin system

**Key limitation**: `permission_mode: bypassPermissions` requires `allow_dangerously_skip_permissions: true`, matching `claude -p --dangerously-skip-permissions` in our current harness.

**Sources**:
- [Claude Agent SDK Provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) — Quality: High, Date: 2026-03-13
- [Tool Calling Configuration](https://www.promptfoo.dev/docs/configuration/tools/) — Quality: High, Date: 2026-03-13
- [Chat Conversations](https://www.promptfoo.dev/docs/configuration/chat/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: Yes

---

## Finding 6: Red-Teaming — Automated Adversarial Scanning

**Summary**: Promptfoo has a separate `redteam` module that auto-generates hundreds of adversarial probes across 50+ vulnerability categories, runs them against the target, and produces a risk report. It uses specialized uncensored attack models (separate from the target model), implements techniques from Microsoft/Meta adversarial ML research, and integrates with CI/CD.

**Evidence**:

```bash
# Initialize red team config interactively
promptfoo redteam init

# Or target a live endpoint directly
promptfoo redteam run
promptfoo redteam report
```

Red team config targets any endpoint:
```yaml
targets:
  - id: https
    label: travel-agent
    config:
      url: https://example.com/generate
      method: POST
      body:
        myPrompt: "{{prompt}}"
  # Or directly attack a model
  - id: anthropic:messages:claude-opus-4-6
    label: claude-direct
```

**Vulnerability categories covered** (50+ total):
- Security: prompt injection, jailbreaks, indirect prompt injection
- Privacy: PII leakage (from training data, from RAG context), data exfiltration
- Agent-specific: unauthorized data access, privilege escalation, SQL injection via tools, API misuse
- Content: harmful content, hate speech, toxicity, bias
- Compliance: OWASP LLM Top 10, NIST AI RMF, EU AI Act frameworks
- RAG-specific: context poisoning, retrieval manipulation
- Custom policies: organizational guidelines enforced as plugins

**Key characteristics**:
- Attack generation uses a *different* model than the target (defaults to OpenAI but configurable)
- Implements state-of-the-art methods: greedy coordinate descent, AutoDAN, jailbreak strategies
- Plugins = adversarial generators; Strategies = wrapping techniques (prompt injection, multi-turn escalation, etc.)
- Produces quantitative risk report with severity levels, concrete failure logs, and mitigation suggestions
- Supports black-box testing (only inputs/outputs) — practical for most deployments

**Relevance**: For our plugin ecosystem, red-teaming could validate that skills don't leak sensitive files, execute unauthorized commands, or be manipulated into bypassing plugin-level permission checks.

**Sources**:
- [Red Teaming Overview](https://www.promptfoo.dev/docs/red-team/) — Quality: High, Date: 2026-03-13
- [Red Team Quickstart](https://www.promptfoo.dev/docs/red-team/quickstart/) — Quality: High, Date: 2026-03-13

**Confidence**: High
**Multi-source**: Yes

---

## Finding 7: Applicability to Claude Code Plugin/Skill Evaluation

**Summary**: Promptfoo is a strong complement to the existing bash harness for structured eval comparison, but replacing the harness wholesale would require significant bridging work. The most valuable integration point is the `anthropic:claude-agent-sdk` provider, which can run real Claude Code sessions with plugin access. The main gap is that promptfoo does not natively parse JSONL transcripts or understand Claude's `stream-json` output format — custom assertion logic would be needed.

**Evidence** (synthesized from local codebase + docs):

### Current harness architecture (from `execute-test.sh` review)
- Runs prompts through `claude -p --output-format stream-json --dangerously-skip-permissions --plugin-dir` for native plugin testing
- Or through `claudish --model <name> --json` for external model routing
- Captures JSONL transcripts + debug logs + meta.json
- Evaluation logic is separate (TypeScript `analyze-results.ts`)

### How promptfoo could complement this

**Scenario A: Drop-in exec provider wrapping claudish**
```yaml
providers:
  - 'exec: claudish --model google/gemini-3-flash-preview --json --stdin'
  - 'exec: claudish --model openai/gpt-5 --json --stdin'
tests:
  - vars:
      task: "Write documentation for skill injection"
    assert:
      - type: llm-rubric
        value: "Documentation covers SKILL.md frontmatter, tool invocation, and content injection"
        provider: anthropic:messages:claude-opus-4-6  # separate grader model
      - type: javascript
        value: "output.length > 500 && !output.includes('AI language model')"
```

This would let us use promptfoo's web UI and result matrix while keeping claudish as the execution layer. Output parsing would need the `transform` field to extract the final assistant message from JSONL.

**Scenario B: Native Claude Agent SDK for skill/plugin testing**
```yaml
providers:
  - id: anthropic:claude-agent-sdk
    config:
      working_dir: /path/to/plugins/dev
      permission_mode: acceptEdits
      append_allowed_tools: [Bash, Write, Edit, Read]
      custom_system_prompt: |
        You have the dev plugin loaded. Test the /dev:implement skill.
      setting_sources:
        - /path/to/plugins/dev    # load CLAUDE.md and skill definitions

tests:
  - vars:
      task: "Implement a simple Python function that reverses a string"
    assert:
      - type: javascript
        value: |
          // Check that output contains a tool_use block for skill invocation
          output.includes('dev:implement') || output.includes('Skill')
      - type: llm-rubric
        value: "Agent correctly invoked the implement skill and produced working code"
```

This is the highest-fidelity path — it tests real Claude Agent SDK behavior with real plugin/skill loading.

**Scenario C: LLM-as-judge scoring (complementing our current Borda count approach)**

Our existing `analyze-results.ts` uses a Borda count + weighted rubric evaluated by LLM judges. Promptfoo's `llm-rubric` and `select-best` assertions could reproduce this within the YAML config, reducing custom TypeScript code.

```yaml
defaultTest:
  assert:
    - type: llm-rubric
      value: "Score 1-10: Absence of AI writing slop (marketing superlatives, hedging, formulaic patterns)"
      provider: anthropic:messages:claude-opus-4-6
    - type: llm-rubric
      value: "Score 1-10: Writing craft — sentence variety, active voice, precise verbs"
      provider: anthropic:messages:claude-opus-4-6
    - type: select-best    # pick best output across providers for each test
```

### Key gaps for our use case

| Gap | Severity | Workaround |
|-----|----------|------------|
| JSONL transcript parsing | Medium | Use `transform` field to extract final message; or wrap in exec provider that echoes final output |
| Plugin-dir loading (`--plugin-dir`) | Medium | Use `setting_sources` in Claude Agent SDK provider, or `exec:` wrapping claude -p |
| Per-judge Borda count aggregation | Medium | Custom JS assertion or post-process with existing analyze-results.ts |
| Blind multi-judge evaluation with randomized order | Medium | Not natively supported — would need custom provider wrapping |
| JSONL debug log capture | Low | Not needed if using native providers; exec provider can capture stderr |
| claudish `--monitor` mode | Low | Not applicable in promptfoo context |

**Sources**:
- [Claude Agent SDK Provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) — Quality: High, Date: 2026-03-13
- [Custom Scripts](https://www.promptfoo.dev/docs/providers/custom-script/) — Quality: High, Date: 2026-03-13
- [Custom Javascript Provider](https://www.promptfoo.dev/docs/providers/custom-api/) — Quality: High, Date: 2026-03-13
- Local codebase: `/Users/jack/mag/magus-bench/tech-writer-eval/execute-test.sh`
- Local codebase: `/Users/jack/mag/magus-bench/tech-writer-eval/test-cases.json`

**Confidence**: High
**Multi-source**: Yes

---

## Source Summary

**Total Sources**: 9
- High Quality: 9 (all official promptfoo.dev documentation pages + local codebase)
- Medium Quality: 0
- Low Quality: 0

**Source List**:
1. [Getting Started](https://www.promptfoo.dev/docs/getting-started/) — Quality: High, Date: 2026-03-13, Type: Official docs
2. [Intro](https://www.promptfoo.dev/docs/intro/) — Quality: High, Date: 2026-03-13, Type: Official docs
3. [Configuration Overview](https://www.promptfoo.dev/docs/configuration/guide/) — Quality: High, Date: 2026-03-13, Type: Official docs
4. [Assertions and Metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/) — Quality: High, Date: 2026-03-13, Type: Official docs
5. [LLM Providers](https://www.promptfoo.dev/docs/providers/) — Quality: High, Date: 2026-03-13, Type: Official docs
6. [Tool Calling](https://www.promptfoo.dev/docs/configuration/tools/) — Quality: High, Date: 2026-03-13, Type: Official docs
7. [Chat Conversations](https://www.promptfoo.dev/docs/configuration/chat/) — Quality: High, Date: 2026-03-13, Type: Official docs
8. [Red Team Overview + Quickstart](https://www.promptfoo.dev/docs/red-team/) — Quality: High, Date: 2026-03-13, Type: Official docs
9. [Claude Agent SDK Provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) — Quality: High, Date: 2026-03-13, Type: Official docs
10. Local: `/Users/jack/mag/magus-bench/tech-writer-eval/execute-test.sh` — Quality: High, Type: Primary codebase
11. Local: `/Users/jack/mag/magus-bench/tech-writer-eval/test-cases.json` — Quality: High, Type: Primary codebase

---

## Knowledge Gaps

What this research did NOT find:

- **Plugin-dir loading specifics in Claude Agent SDK provider**: The docs mention `setting_sources` for loading CLAUDE.md and slash commands, but it's unclear if `--plugin-dir` (a Claude CLI flag for loading locally-developed plugins not yet in the cache) maps directly to `setting_sources`. Suggested follow-up: test empirically or check the `@anthropic-ai/claude-agent-sdk` package source.
  - Suggested query: `"promptfoo claude-agent-sdk setting_sources plugin-dir"`

- **JSONL transcript capture from exec providers**: Docs show exec providers return stdout as the `output` field. It's unclear if stderr (debug logs) is accessible for post-processing. Suggested query: `"promptfoo exec provider stderr capture"`

- **Concurrent multi-judge evaluation**: Our current design runs 7 judges concurrently per generation. Promptfoo's `providers` list runs providers in parallel, but the relationship to our Borda count aggregation workflow isn't directly supported. A custom post-processing script or the `select-best` / `max-score` assertions would be needed.

- **OpenAI acquisition impact**: Promptfoo announced joining OpenAI in early 2026. This could affect licensing, open-source status, or feature direction. The current docs still describe it as open-source with "no strings attached," but this bears watching.
  - Suggested query: `"promptfoo OpenAI acquisition open source license 2026"`

---

## Relevance to Our Use Case

### Strong Fit Areas

**1. Declarative test case management**: Our `test-cases.json` structure (criteria, approaches, judges) maps reasonably well to promptfoo's `tests`, `providers`, and `assert` schema. Moving to YAML would improve readability and enable promptfoo's templating, combinatorial vars, and external file loading.

**2. Multi-model comparison**: This is promptfoo's core strength. Our 4-way comparison (default, techwriter, gemini, reference) maps exactly to 4 providers. The matrix view would replace our custom `analyze-results.ts` grid display.

**3. LLM-as-judge scoring**: `llm-rubric` assertions can directly encode our weighted criteria (AI Slop Absence, Writing Craft, Readability, etc.). The `weight` property maps to our weight column. `select-best` could replace our Borda count logic for pairwise ranking.

**4. Claude Agent SDK integration**: The `anthropic:claude-agent-sdk` provider is the most compelling integration point for plugin/skill testing. It can load real Claude Code sessions with filesystem access, tool execution, and (via `setting_sources`) CLAUDE.md-based configuration — giving us a standardized way to test skills without bespoke bash scripting.

**5. Tool call validation**: For skills that are expected to call specific tools (e.g., the `Bash` tool in `/dev:implement`), `is-valid-openai-tools-call` and custom JavaScript assertions can verify that the correct tools were invoked with correct arguments.

### Weak Fit / Integration Work Required

**1. JSONL transcript parsing**: Our current harness generates `transcript.jsonl` in `stream-json` format. Promptfoo's native providers return a single `output` string. Bridging this requires either: (a) a custom exec provider that post-processes the JSONL and echoes the final assistant message, or (b) moving fully to the Claude Agent SDK provider which handles this internally.

**2. Blind multi-judge with randomized sample order**: Our benchmark randomizes which sample (A/B/C/D) each judge sees to prevent position bias. Promptfoo doesn't have a built-in "randomize provider order per judge" mechanism. This would need a custom provider wrapper or pre-processing step.

**3. Statistical analysis (Friedman/Borda)**: `analyze-results.ts` runs Friedman tests and Wilcoxon signed-rank tests. Promptfoo produces pass/fail counts and weighted scores, but does not run non-parametric statistical significance tests. Our existing TypeScript analyzer would need to consume promptfoo's JSON output format instead of our custom JSONL transcripts.

**4. claudish integration for external models**: `claudish` routes prompts to OpenRouter-hosted models (MiniMax, Kimi, GLM, Qwen, etc.) with our custom configuration. This could be wrapped as `exec: claudish --model X --json --stdin` or `exec: claudish --model X --stdin`, but the JSONL output format would need transform handling.

### Recommended Integration Path

**Phase 1 (Low risk, immediate value)**: Use promptfoo for the tech-writer-eval benchmark's generation phase. Define 4 providers (internal Claude, claudish/gemini, claudish/gpt, reference-doc-echo) and our 9 criteria as `llm-rubric` assertions. Run `promptfoo eval` to get the matrix view. Keep `analyze-results.ts` consuming promptfoo's JSON output for statistical analysis.

**Phase 2 (Medium risk, high value)**: Use `anthropic:claude-agent-sdk` to test skill invocations directly. Define test cases for each of the ~47 skills: expected tool calls, expected output patterns, refusal cases. This replaces the most brittle part of the bash harness with promptfoo's standardized runner.

**Phase 3 (Optional)**: Migrate the Borda/Friedman analysis into promptfoo's assertion framework using custom JS assertions and `select-best`. This reduces external dependencies but increases promptfoo-specific complexity.

---

## Search Limitations

- Model: claude-sonnet-4-6 (native, no web search)
- Web search: unavailable (MODEL_STRATEGY=native)
- Local search: performed (tech-writer-eval codebase reviewed)
- HTTP fetch: 8 promptfoo.dev documentation pages fetched directly via curl
- Date range: docs last updated 2026-03-13 per page footers
- Query refinement: performed (tool-calling URL corrected from /guides/evaluate-tools/ to /configuration/tools/)
