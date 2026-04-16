#!/usr/bin/env bun
/**
 * Synthetic test case generator for skill/agent routing evaluation.
 *
 * Reads seed test cases from the claude-code autotest suite, calls Claude
 * to generate natural-language variations, and writes output in both
 * promptfoo YAML and autotest JSON formats.
 *
 * Usage:
 *   bun run generate-test-cases.ts [options]
 *
 * Options:
 *   --count <n>      Variations per seed case (default: 10)
 *   --dry-run        Show what would be generated without API calls
 *   --seed-skills    Path to skills seed file (default: auto-detected)
 *   --seed-agents    Path to agents seed file (default: auto-detected)
 *   --out-dir <dir>  Output directory (default: ./generated)
 *   --help           Show this help
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeedMeta {
  description: string;
  version: string;
  created: string;
  notes?: string;
}

/** Shape of a skill-routing seed test case */
interface SkillSeedCase {
  id: string;
  description: string;
  prompt: string;
  checks: Record<string, unknown>;
  category: string;
  tags?: string[];
}

/** Shape of a subagent-routing seed test case */
interface AgentSeedCase {
  id: string;
  description: string;
  prompt: string;
  expected_agent: string;
  expected_alternatives?: string[];
  category: string;
  tags?: string[];
}

type SeedCase = SkillSeedCase | AgentSeedCase;

interface SeedFile<T extends SeedCase> {
  meta: SeedMeta;
  test_cases: T[];
}

/** A generated variation produced by Claude */
interface GeneratedVariant {
  id: string;
  prompt: string;
  expected_outcome: string;
  category: string;
  variant_type: "rephrased" | "edge_case" | "adversarial" | "context_shift" | "terse" | "verbose";
  difficulty: "easy" | "medium" | "hard";
  rationale: string;
}

/** Unified output record for both formats */
interface OutputCase {
  id: string;
  prompt: string;
  expected_outcome: string;
  category: string;
  variant_type: string;
  difficulty: string;
  rationale: string;
  seed_id: string;
  /** original checks object, only present for skill-derived cases */
  checks?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  count: number;
  dryRun: boolean;
  seedSkillsPath: string;
  seedAgentsPath: string;
  outDir: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const defaults: CliArgs = {
    count: 10,
    dryRun: false,
    seedSkillsPath: resolve(
      import.meta.dir,
      "../../claude-code/autotest/skills/test-cases.json"
    ),
    seedAgentsPath: resolve(
      import.meta.dir,
      "../../claude-code/autotest/subagents/test-cases.json"
    ),
    outDir: resolve(import.meta.dir, "generated"),
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--count":
        defaults.count = parseInt(args[++i], 10);
        break;
      case "--dry-run":
        defaults.dryRun = true;
        break;
      case "--seed-skills":
        defaults.seedSkillsPath = resolve(args[++i]);
        break;
      case "--seed-agents":
        defaults.seedAgentsPath = resolve(args[++i]);
        break;
      case "--out-dir":
        defaults.outDir = resolve(args[++i]);
        break;
      case "--help":
        console.log(`
Synthetic test case generator for skill/agent routing eval.

Usage:
  bun run generate-test-cases.ts [options]

Options:
  --count <n>         Variations per seed case (default: 10)
  --dry-run           Preview generation plan without API calls
  --seed-skills <p>   Path to skills seed JSON
  --seed-agents <p>   Path to agents seed JSON
  --out-dir <dir>     Output directory (default: ./generated)
  --help              Show this help
        `.trim());
        process.exit(0);
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// Seed loading helpers
// ---------------------------------------------------------------------------

function loadSeedFile<T extends SeedCase>(path: string): SeedFile<T> {
  if (!existsSync(path)) {
    throw new Error(`Seed file not found: ${path}`);
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as SeedFile<T>;
}

function expectedOutcomeForSeed(seed: SeedCase): string {
  if ("expected_agent" in seed) {
    return seed.expected_agent;
  }
  // For skill seeds derive a human-readable expectation from checks
  const checks = (seed as SkillSeedCase).checks;
  if (checks.skill_invoked_is) return String(checks.skill_invoked_is);
  if (checks.skill_invoked_contains) return `skill:*${checks.skill_invoked_contains}*`;
  if (checks.no_skill_invoked) return "NO_SKILL_INVOKED";
  if (checks.task_agent_is) return String(checks.task_agent_is);
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Prompt template rendering
// ---------------------------------------------------------------------------

function loadPromptTemplate(scriptDir: string): string {
  const templatePath = join(scriptDir, "prompts", "generate-variations.md");
  if (!existsSync(templatePath)) {
    throw new Error(`Prompt template not found: ${templatePath}`);
  }
  return readFileSync(templatePath, "utf-8");
}

function renderPrompt(
  template: string,
  seed: SeedCase,
  expectedOutcome: string,
  count: number
): string {
  const tags = seed.tags?.join(", ") ?? "(none)";
  return template
    .replaceAll("{{seed_id}}", seed.id)
    .replaceAll("{{seed_prompt}}", seed.prompt.replaceAll('"', '\\"'))
    .replaceAll("{{expected_outcome}}", expectedOutcome)
    .replaceAll("{{category}}", seed.category)
    .replaceAll("{{tags}}", tags)
    .replaceAll("{{count}}", String(count));
}

// ---------------------------------------------------------------------------
// API call — tries @anthropic-ai/sdk first, falls back to claude CLI
// ---------------------------------------------------------------------------

async function callClaudeSDK(prompt: string): Promise<string> {
  // Dynamic import so the script doesn't crash if the SDK isn't installed
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content[0];
  if (block.type !== "text") throw new Error("Unexpected non-text response block");
  return block.text;
}

function callClaudeCLI(prompt: string): string {
  // Write prompt to a temp file to avoid shell escaping issues
  const tmpFile = `/tmp/gen-prompt-${Date.now()}.txt`;
  writeFileSync(tmpFile, prompt, "utf-8");
  try {
    const result = execSync(`claude -p "$(cat ${tmpFile})"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    return result;
  } finally {
    try { execSync(`rm -f ${tmpFile}`); } catch { /* ignore */ }
  }
}

async function callClaude(prompt: string): Promise<string> {
  try {
    return await callClaudeSDK(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // SDK not installed or auth issue — fall back to CLI
    if (message.includes("Cannot find") || message.includes("MODULE_NOT_FOUND")) {
      console.log("  [info] @anthropic-ai/sdk not available, falling back to claude CLI");
      return callClaudeCLI(prompt);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// JSON extraction — Claude sometimes wraps JSON in markdown fences
// ---------------------------------------------------------------------------

function extractJsonArray(raw: string): GeneratedVariant[] {
  // Try raw parse first
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as GeneratedVariant[];
  }
  // Strip markdown fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    return JSON.parse(fenceMatch[1]) as GeneratedVariant[];
  }
  throw new Error(`Could not extract JSON array from response:\n${raw.slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Deduplication — Jaccard similarity on token sets
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function deduplicate(cases: OutputCase[], threshold = 0.8): OutputCase[] {
  const kept: OutputCase[] = [];
  const keptTokens: Set<string>[] = [];

  for (const c of cases) {
    const tokens = tokenize(c.prompt);
    const isDuplicate = keptTokens.some(
      (existing) => jaccardSimilarity(tokens, existing) >= threshold
    );
    if (!isDuplicate) {
      kept.push(c);
      keptTokens.push(tokens);
    } else {
      console.log(`  [dedup] Dropped near-duplicate: "${c.prompt.slice(0, 60)}..."`);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function toAutotestJson(cases: OutputCase[], seeds: SeedCase[]): object {
  return {
    meta: {
      description:
        "Synthetically generated routing test cases. Each case is a Claude-generated variation of a seed test from the autotest suite.",
      version: "1.0.0",
      created: new Date().toISOString().split("T")[0],
      seed_count: seeds.length,
      generated_count: cases.length,
      generator: "generate-test-cases.ts",
    },
    test_cases: cases.map((c) => ({
      id: c.id,
      description: c.rationale,
      prompt: c.prompt,
      expected_outcome: c.expected_outcome,
      category: c.category,
      variant_type: c.variant_type,
      difficulty: c.difficulty,
      seed_id: c.seed_id,
      ...(c.checks ? { checks: c.checks } : {}),
    })),
  };
}

function toPromptfooYaml(cases: OutputCase[]): string {
  const lines: string[] = [
    "# Synthetically generated skill/agent routing test cases",
    `# Generated: ${new Date().toISOString()}`,
    `# Total cases: ${cases.length}`,
    "# Generator: generate-test-cases.ts",
    "",
    "tests:",
  ];

  for (const c of cases) {
    // Escape special YAML characters in the prompt
    const escapedPrompt = c.prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedRationale = c.rationale.replace(/"/g, '\\"');

    lines.push(`  - description: "${c.id}"`);
    lines.push(`    # ${escapedRationale}`);
    lines.push(`    # category: ${c.category} | variant: ${c.variant_type} | difficulty: ${c.difficulty}`);
    lines.push(`    # seed: ${c.seed_id}`);
    lines.push(`    vars:`);
    lines.push(`      prompt: "${escapedPrompt}"`);
    lines.push(`      expected_outcome: "${c.expected_outcome}"`);
    lines.push(`    assert:`);

    // Generate assertions based on expected_outcome
    const outcome = c.expected_outcome;
    if (outcome === "NO_TASK_CALL" || outcome === "NO_SKILL_INVOKED") {
      lines.push(`      - type: javascript`);
      lines.push(`        value: "!output.includes('Task') && !output.includes('subagent')"`);
    } else if (outcome.startsWith("NO_SKILL")) {
      lines.push(`      - type: javascript`);
      lines.push(`        value: "!output.includes('Skill')"`);
    } else if (outcome.startsWith("skill:*")) {
      const fragment = outcome.replace("skill:*", "").replace("*", "");
      lines.push(`      - type: contains`);
      lines.push(`        value: "${fragment}"`);
    } else {
      // Named agent or skill — expect it to appear in the response
      lines.push(`      - type: contains`);
      lines.push(`        value: "${outcome}"`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main generation loop
// ---------------------------------------------------------------------------

interface GenerationPlan {
  seed: SeedCase;
  expectedOutcome: string;
  renderedPrompt: string;
  count: number;
}

async function buildPlans(
  seeds: SeedCase[],
  template: string,
  count: number
): Promise<GenerationPlan[]> {
  return seeds.map((seed) => {
    const expectedOutcome = expectedOutcomeForSeed(seed);
    const renderedPrompt = renderPrompt(template, seed, expectedOutcome, count);
    return { seed, expectedOutcome, renderedPrompt, count };
  });
}

function printDryRunPlan(plans: GenerationPlan[]): void {
  console.log("\n=== DRY RUN — no API calls will be made ===\n");
  console.log(`Total seeds: ${plans.length}`);
  console.log(`Variations per seed: ${plans[0]?.count ?? 0}`);
  console.log(`Estimated total cases: ${plans.length * (plans[0]?.count ?? 0)} (before dedup)\n`);

  for (const plan of plans) {
    console.log(`Seed: ${plan.seed.id}`);
    console.log(`  Category:  ${plan.seed.category}`);
    console.log(`  Expected:  ${plan.expectedOutcome}`);
    console.log(`  Prompt:    ${plan.seed.prompt.slice(0, 80)}...`);
    console.log(`  Variations to generate: ${plan.count}`);
    console.log();
  }

  console.log("--- Rendered prompt template for first seed ---\n");
  console.log(plans[0]?.renderedPrompt ?? "(no seeds)");
}

async function runGeneration(
  plans: GenerationPlan[],
  template: string
): Promise<OutputCase[]> {
  const allCases: OutputCase[] = [];

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const progress = `[${i + 1}/${plans.length}]`;
    console.log(`${progress} Generating variations for: ${plan.seed.id}`);
    console.log(`  Category: ${plan.seed.category} | Expected: ${plan.expectedOutcome}`);

    let raw: string;
    try {
      raw = await callClaude(plan.renderedPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [error] API call failed: ${message}`);
      console.error("  Skipping this seed.");
      continue;
    }

    let variants: GeneratedVariant[];
    try {
      variants = extractJsonArray(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [error] JSON parse failed: ${message}`);
      console.error("  Skipping this seed.");
      continue;
    }

    console.log(`  Generated ${variants.length} variants`);

    const seedChecks =
      "checks" in plan.seed ? (plan.seed as SkillSeedCase).checks : undefined;

    for (const v of variants) {
      allCases.push({
        id: v.id,
        prompt: v.prompt,
        expected_outcome: v.expected_outcome ?? plan.expectedOutcome,
        category: v.category ?? plan.seed.category,
        variant_type: v.variant_type,
        difficulty: v.difficulty,
        rationale: v.rationale,
        seed_id: plan.seed.id,
        ...(seedChecks ? { checks: seedChecks } : {}),
      });
    }
  }

  return allCases;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const scriptDir = import.meta.dir;

  console.log("Skill/Agent Routing Test Case Generator");
  console.log("========================================");
  console.log(`Variations per seed : ${args.count}`);
  console.log(`Dry run             : ${args.dryRun}`);
  console.log(`Seed skills file    : ${args.seedSkillsPath}`);
  console.log(`Seed agents file    : ${args.seedAgentsPath}`);
  console.log(`Output directory    : ${args.outDir}`);
  console.log();

  // Load seeds
  console.log("Loading seed files...");
  const skillSeed = loadSeedFile<SkillSeedCase>(args.seedSkillsPath);
  const agentSeed = loadSeedFile<AgentSeedCase>(args.seedAgentsPath);
  const allSeeds: SeedCase[] = [
    ...skillSeed.test_cases,
    ...agentSeed.test_cases,
  ];
  console.log(
    `  Loaded ${skillSeed.test_cases.length} skill seeds + ${agentSeed.test_cases.length} agent seeds = ${allSeeds.length} total`
  );

  // Load prompt template
  const template = loadPromptTemplate(scriptDir);
  console.log("  Loaded prompt template from prompts/generate-variations.md");
  console.log();

  // Build generation plans
  const plans = await buildPlans(allSeeds, template, args.count);

  if (args.dryRun) {
    printDryRunPlan(plans);
    return;
  }

  // Estimate output
  const estimatedTotal = plans.length * args.count;
  console.log(
    `Starting generation: ${plans.length} seeds × ${args.count} variations = ~${estimatedTotal} cases`
  );
  console.log();

  // Generate
  const rawCases = await runGeneration(plans, template);
  console.log(`\nRaw generated cases : ${rawCases.length}`);

  // Deduplicate
  console.log("Running deduplication (Jaccard threshold: 0.80)...");
  const dedupedCases = deduplicate(rawCases);
  console.log(`After deduplication : ${dedupedCases.length} cases`);

  if (dedupedCases.length < 100) {
    console.warn(
      `\n[warn] Only ${dedupedCases.length} cases generated; target is 100+.` +
        ` Try increasing --count or adding more seed files.`
    );
  }

  // Write outputs
  mkdirSync(args.outDir, { recursive: true });

  const jsonOutput = toAutotestJson(dedupedCases, allSeeds);
  const jsonPath = join(args.outDir, "test-cases-generated.json");
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2) + "\n", "utf-8");
  console.log(`\nWrote JSON : ${jsonPath}`);

  const yamlOutput = toPromptfooYaml(dedupedCases);
  const yamlPath = join(args.outDir, "test-cases-generated.yaml");
  writeFileSync(yamlPath, yamlOutput, "utf-8");
  console.log(`Wrote YAML : ${yamlPath}`);

  // Summary by category
  const byCat: Record<string, number> = {};
  for (const c of dedupedCases) {
    byCat[c.category] = (byCat[c.category] ?? 0) + 1;
  }
  console.log("\n=== Cases by category ===");
  for (const [cat, count] of Object.entries(byCat).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${cat.padEnd(24)} ${count}`);
  }

  const byDiff: Record<string, number> = {};
  for (const c of dedupedCases) {
    byDiff[c.difficulty] = (byDiff[c.difficulty] ?? 0) + 1;
  }
  console.log("\n=== Cases by difficulty ===");
  for (const [diff, count] of Object.entries(byDiff)) {
    console.log(`  ${diff.padEnd(24)} ${count}`);
  }

  console.log(`\nDone. ${dedupedCases.length} test cases written to ${args.outDir}/`);
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
