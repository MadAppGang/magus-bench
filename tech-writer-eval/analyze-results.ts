#!/usr/bin/env bun
/**
 * analyze-results.ts - 4-Way Reference-Based Documentation Benchmark Analyzer
 *
 * Parses judge responses from the 4-way tech-writer benchmark, de-blinds slot
 * labels back to approach names via sample-mapping.json, computes per-criterion
 * statistics, Borda count ranking, and generates two-table Markdown + JSON reports.
 *
 * Usage:
 *   bun research/tech-writer-eval/analyze-results.ts <run-dir>
 *
 * The run-dir must contain:
 *   - sample-mapping.json  (per-judge slot randomization record)
 *   - judge/<id>/response.txt  OR  judge/<id>/transcript.jsonl
 *
 * test-cases.json is loaded from the script's own directory (research/tech-writer-eval/).
 *
 * Outputs:
 *   <run-dir>/report/tech-writer-benchmark.json
 *   <run-dir>/report/tech-writer-benchmark.md
 *   stdout — human-readable summary
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Criterion {
  id: string;
  name: string;
  weight: number;
  description: string;
}

interface JudgeConfig {
  id: string;
  model: string;
  method: string;
}

interface TestCasesConfig {
  topic: { title: string };
  approaches: string[];
  evaluation: {
    criteria: Criterion[];
    total_weight: number;
    score_range: { min: number; max: number };
  };
  judges: JudgeConfig[];
  thresholds: {
    min_judges: number;
    min_output_chars: number;
    score_clamp: [number, number];
  };
}

interface SampleMapping {
  contestants: Record<string, string>;
  // e.g. {"A": "default", "B": "techwriter", "C": "reference", "D": "gemini"}
  judge_orderings: Record<string, string[]>;
  // e.g. {"internal": ["C","A","D","B"], ...}
  created_at: string;
}

interface JudgeResponse {
  scores: {
    sample_a: Record<string, number>;
    sample_b: Record<string, number>;
    sample_c: Record<string, number>;
    sample_d: Record<string, number>;
  };
  ranking: string[]; // e.g. ["C", "A", "D", "B"] — slot labels, 1st to 4th
  reasoning: string;
}

// Scores keyed by criterion id, after de-blinding
type ApproachScores = Record<string, number>;

interface JudgeResult {
  judge_id: string;
  model: string;
  ordering: string[]; // This judge's slot ordering from sample-mapping.json
  raw_scores: JudgeResponse;
  deblinded_scores: Record<string, ApproachScores>; // approach -> criterion -> score
  ranking_deblinded: string[]; // ["reference", "techwriter", "gemini", "default"]
  parse_method: string; // "json" | "fenced_json" | "regex" | "failed"
  raw_response_length: number;
}

interface CriterionStats {
  criterion_id: string;
  criterion_name: string;
  weight: number;
  scores_by_approach: Record<string, number[]>; // approach -> array of judge scores
  mean_by_approach: Record<string, number>;
  stddev_by_approach: Record<string, number>;
  min_by_approach: Record<string, number>;
  max_by_approach: Record<string, number>;
}

interface StatisticalTests {
  friedman_statistic: number;
  friedman_p: number;
  wilcoxon_pairwise: Record<string, number>; // "default_vs_techwriter" -> p-value
  bootstrap_ci: Record<string, [number, number]>; // approach -> [low95, high95]
  significance_note: string;
}

interface BenchmarkReport {
  run_dir: string;
  analyzed_at: string;
  topic: string;
  sample_mapping: SampleMapping;
  total_judges: number;
  successful_judges: number;
  failed_judges: string[];
  criteria_results: CriterionStats[];
  weighted_scores: Record<string, number>; // approach -> weighted score
  borda_counts: Record<string, number>; // approach -> total Borda points
  absolute_ranking: string[]; // All 4, best to worst
  ai_only_ranking: string[]; // 3 AI approaches only
  reference_calibration: {
    reference_weighted_score: number;
    reference_borda: number;
    ai_gap: Record<string, number>; // approach -> gap from reference score
  };
  statistical_tests?: StatisticalTests;
  judge_details: JudgeResult[];
}

// TranscriptEntry for parsing claudish JSONL transcript files
interface TranscriptContentBlock {
  type: string;
  text?: string;
}

interface TranscriptMessage {
  content?: TranscriptContentBlock[];
}

interface TranscriptEntry {
  type: string;
  result?: string;
  message?: TranscriptMessage;
}

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function c(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

// ---------------------------------------------------------------------------
// Score parsing helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a score to [1, 10]. Returns 5 for non-finite values.
 */
function clamp(score: number): number {
  if (!Number.isFinite(score)) return 5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

/**
 * Try to parse a 4-way JudgeResponse from raw text.
 * Attempts multiple strategies:
 *   1. Direct JSON.parse
 *   2. Extract from markdown fenced code block
 *   3. Regex: find JSON object containing "scores" and "sample_a"
 *   4. Fallback: log parse failure
 */
function parseJudgeResponse(
  text: string
): { response: JudgeResponse; method: string } | null {
  const validators: Array<[string, (obj: unknown) => obj is JudgeResponse]> = [
    [
      "direct",
      (obj): obj is JudgeResponse =>
        typeof obj === "object" &&
        obj !== null &&
        "scores" in obj &&
        typeof (obj as Record<string, unknown>).scores === "object" &&
        (obj as Record<string, unknown>).scores !== null &&
        "sample_a" in ((obj as Record<string, unknown>).scores as object),
    ],
  ];

  function tryParse(json: string): JudgeResponse | null {
    try {
      const parsed: unknown = JSON.parse(json);
      if (validators[0][1](parsed)) return parsed;
      // Also check if scores exist even without full validation
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "scores" in parsed
      ) {
        return parsed as JudgeResponse;
      }
    } catch {
      // ignore
    }
    return null;
  }

  // Pre-processing: strip coaching prefix if present (injected by dev plugin SessionStart hook)
  let cleaned = text.trim();
  const coachingMatch = cleaned.match(/^`★ Coaching[\s\S]*?`─{10,}`?\s*/);
  if (coachingMatch) {
    cleaned = cleaned.slice(coachingMatch[0].length).trim();
  }

  // Strategy 1: Direct parse
  const direct = tryParse(cleaned);
  if (direct) return { response: direct, method: "json" };

  // Strategy 2: Fenced code block
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const fenced = tryParse(fenceMatch[1].trim());
    if (fenced) return { response: fenced, method: "fenced_json" };
  }

  // Strategy 3: Regex — find the largest JSON object with "scores" and "sample_a"
  const jsonMatch = cleaned.match(
    /\{[\s\S]*?"scores"[\s\S]*?"sample_a"[\s\S]*?\}/
  );
  if (jsonMatch) {
    const regex = tryParse(jsonMatch[0]);
    if (regex) return { response: regex, method: "regex" };
  }

  // Fallback: try to find any JSON object
  const anyJsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (anyJsonMatch) {
    const any = tryParse(anyJsonMatch[0]);
    if (any) return { response: any, method: "regex" };
  }

  return null;
}

/**
 * Extract the final text response from a claudish transcript.jsonl file.
 */
function extractFromTranscript(transcriptPath: string): string {
  const content = readFileSync(transcriptPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Strategy 1: "result" type entry (claudish --json format)
  for (const line of lines) {
    try {
      const entry: TranscriptEntry = JSON.parse(line);
      if (
        entry.type === "result" &&
        typeof entry.result === "string" &&
        entry.result.length > 50
      ) {
        return entry.result;
      }
    } catch {
      continue;
    }
  }

  // Strategy 2: Last assistant text blocks
  let lastText = "";
  for (const line of lines) {
    try {
      const entry: TranscriptEntry = JSON.parse(line);
      if (entry.type === "assistant" && entry.message?.content) {
        const texts = entry.message.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text!)
          .join("\n");
        if (texts) lastText = texts;
      }
    } catch {
      continue;
    }
  }

  return lastText;
}

// ---------------------------------------------------------------------------
// De-blinding
// ---------------------------------------------------------------------------

/**
 * De-blind slot scores to approach names for one judge.
 *
 * ordering[i] = which contestant label was in slot i (A=0, B=1, C=2, D=3)
 * e.g. ordering=["C","A","D","B"] means slot A held contestant C = "reference"
 */
function deblindScores(
  judgeResponse: JudgeResponse,
  mapping: SampleMapping,
  judgeId: string
): Record<string, ApproachScores> {
  const ordering = mapping.judge_orderings[judgeId];
  const slotNames = ["sample_a", "sample_b", "sample_c", "sample_d"] as const;
  const result: Record<string, ApproachScores> = {};

  ordering.forEach((contestantLabel, slotIndex) => {
    const approach = mapping.contestants[contestantLabel];
    if (!approach) return;
    const slotKey = slotNames[slotIndex];
    result[approach] = { ...(judgeResponse.scores[slotKey] ?? {}) };
  });

  return result;
}

/**
 * De-blind ranking slot labels to approach names for one judge.
 *
 * The judge returns ranking = ["A","C","B","D"] — slot labels in order 1st..4th.
 * We map each slot label to its contestant label (via ordering), then to approach name.
 *
 * ordering[0] = contestant label for slot A
 * ordering[1] = contestant label for slot B
 * ...so slotToContestant["A"] = ordering[0], ["B"] = ordering[1], etc.
 */
function deblindRanking(
  ranking: string[],
  mapping: SampleMapping,
  judgeId: string
): string[] {
  const ordering = mapping.judge_orderings[judgeId];
  // Map slot letter -> contestant label
  const slotToContestant: Record<string, string> = {
    A: ordering[0],
    B: ordering[1],
    C: ordering[2],
    D: ordering[3],
  };
  return ranking.map((slot) => {
    const contestantLabel = slotToContestant[slot];
    return mapping.contestants[contestantLabel] ?? slot;
  });
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Friedman test: non-parametric repeated measures.
 * data[judge][approach] — rows=judges, cols=approaches (ordered consistently).
 * Returns chi-squared statistic and approximate p-value (chi-sq distribution, df=k-1).
 */
function friedmanTest(data: number[][]): { statistic: number; p: number } {
  const n = data.length; // number of judges
  if (n < 2) return { statistic: 0, p: 1 };
  const k = data[0].length; // number of contestants

  // Rank each judge's row independently (tied ranks: average)
  const ranked = data.map((row) => {
    const sorted = [...row].sort((a, b) => a - b);
    return row.map((val) => {
      const rank = sorted.indexOf(val) + 1;
      // Handle ties: average rank
      const count = sorted.filter((v) => v === val).length;
      const firstIdx = sorted.indexOf(val) + 1;
      return firstIdx + (count - 1) / 2;
    });
  });

  // Column (approach) rank sums
  const colSums = Array(k).fill(0) as number[];
  for (const row of ranked) {
    row.forEach((r, j) => {
      colSums[j] += r;
    });
  }

  // Friedman statistic: Ff = (12 / (n*k*(k+1))) * sum(Rj^2) - 3*n*(k+1)
  const sumSqRanks = colSums.reduce((s, r) => s + r * r, 0);
  const statistic = (12 / (n * k * (k + 1))) * sumSqRanks - 3 * n * (k + 1);

  // Approximate p-value using chi-squared with df=k-1
  const df = k - 1;
  const p = chiSquaredPValue(statistic, df);

  return { statistic: round2(statistic), p: round2(p) };
}

/**
 * Approximate chi-squared p-value (survival function) using Wilson-Hilferty
 * normal approximation. Accurate for df >= 1 and x >= 0.
 */
function chiSquaredPValue(x: number, df: number): number {
  if (x <= 0) return 1;
  // Wilson-Hilferty approximation: (X/df)^(1/3) ~ Normal(1 - 2/(9df), 2/(9df))
  const mean_wh = 1 - 2 / (9 * df);
  const var_wh = 2 / (9 * df);
  const z = ((x / df) ** (1 / 3) - mean_wh) / Math.sqrt(var_wh);
  // P(Z > z) = 1 - Phi(z)
  return 1 - normalCDF(z);
}

/**
 * Standard normal CDF via rational approximation (Abramowitz & Stegun 26.2.17).
 * Error < 7.5e-8.
 */
function normalCDF(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // erf approximation
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    t *
      Math.exp(-x * x) *
      (0.254829592 +
        t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 0.5 * (1 + sign * erf);
}

/**
 * Wilcoxon signed-rank test for paired differences (two approaches, n judges).
 * Returns approximate p-value (two-tailed, normal approximation for n >= 5).
 */
function wilcoxonSignedRank(a: number[], b: number[]): number {
  const diffs = a.map((ai, i) => ai - b[i]).filter((d) => d !== 0);
  if (diffs.length < 3) return 1; // too few non-zero diffs

  const absDiffs = diffs.map(Math.abs);
  const sorted = [...absDiffs].sort((x, y) => x - y);

  let wPlus = 0;
  let wMinus = 0;

  diffs.forEach((d) => {
    const rank = sorted.indexOf(Math.abs(d)) + 1;
    if (d > 0) wPlus += rank;
    else wMinus += rank;
  });

  const n = diffs.length;
  const w = Math.min(wPlus, wMinus);
  // Normal approximation
  const meanW = (n * (n + 1)) / 4;
  const varW = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = (w - meanW) / Math.sqrt(varW);
  const p = 2 * normalCDF(z); // two-tailed

  return round2(Math.min(1, Math.max(0, p)));
}

/**
 * Bootstrap 95% CI for the mean of scores (1000 resamples).
 * Returns [2.5th percentile, 97.5th percentile].
 */
function bootstrapCI(scores: number[], n: number = 1000): [number, number] {
  if (scores.length === 0) return [0, 0];
  const bootstrapMeans: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < scores.length; j++) {
      sum += scores[Math.floor(Math.random() * scores.length)];
    }
    bootstrapMeans.push(sum / scores.length);
  }
  bootstrapMeans.sort((a, b) => a - b);
  const lo = bootstrapMeans[Math.floor(n * 0.025)];
  const hi = bootstrapMeans[Math.floor(n * 0.975)];
  return [round2(lo), round2(hi)];
}

// ---------------------------------------------------------------------------
// Borda count
// ---------------------------------------------------------------------------

/**
 * Borda count: 3 pts for 1st, 2 for 2nd, 1 for 3rd, 0 for 4th.
 * Accumulates across all successful judges.
 */
function computeBordaCount(judgeResults: JudgeResult[]): Record<string, number> {
  const n = 4; // number of contestants
  const totals: Record<string, number> = {};

  for (const judge of judgeResults) {
    judge.ranking_deblinded.forEach((approach, rank) => {
      totals[approach] = (totals[approach] ?? 0) + (n - 1 - rank);
    });
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateMarkdownReport(
  report: BenchmarkReport,
  criteria: Criterion[],
  approaches: string[]
): string {
  const approaches4 = report.absolute_ranking; // all 4 sorted best-to-worst
  const aiApproaches = approaches.filter((a) => a !== "reference");

  // Helper: ordinal suffix
  function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  }

  function bordaRankStr(approach: string, ranking: string[], borda: Record<string, number>): string {
    const rank = ranking.indexOf(approach) + 1;
    return `${ordinal(rank)} (${borda[approach] ?? 0})`;
  }

  // Column header: criterion names (short)
  const critCols = criteria.map((cr) => cr.id);

  // Helper: format a score cell
  function scoreCell(approach: string, critId: string): string {
    const cr = report.criteria_results.find((c) => c.criterion_id === critId);
    if (!cr) return "–";
    const m = cr.mean_by_approach[approach];
    return m !== undefined ? String(round1(m)) : "–";
  }

  // ---- Table 1: All 4 contestants ----
  let md = `# Tech-Writer 4-Way Benchmark Results

**Topic**: ${report.topic}
**Date**: ${report.analyzed_at.split("T")[0]}
**Judges**: ${report.successful_judges}/${report.total_judges} successful

## Table 1: All Contestants (Absolute Ranking)

`;

  // Build header
  const t1Header = ["Approach", ...critCols, "Weighted", "Borda"];
  md += `| ${t1Header.join(" | ")} |\n`;
  md += `| ${t1Header.map(() => "---").join(" | ")} |\n`;

  for (const approach of approaches4) {
    const weighted = report.weighted_scores[approach];
    const bordaStr = bordaRankStr(approach, approaches4, report.borda_counts);
    const scores = critCols.map((cid) => scoreCell(approach, cid));
    const row = [approach, ...scores, String(round1(weighted)), bordaStr];
    md += `| ${row.join(" | ")} |\n`;
  }

  md += `
> Note: Reference doc scored on the same rubric as AI contestants. The \`slop\`
> criterion inherently favors human-authored text even at 2x weight.

`;

  // ---- Table 2: AI-only with reference as calibration ----
  const aiOnly = report.ai_only_ranking;
  const refScore = report.reference_calibration.reference_weighted_score;
  const aiGap = report.reference_calibration.ai_gap;

  md += `## Table 2: AI Approaches (Reference as Calibration Anchor)

`;

  // Reference row first as baseline, then AI approaches
  const t2Header = ["Approach", ...critCols, "Weighted", "Borda", "Gap to Ref"];
  md += `| ${t2Header.join(" | ")} |\n`;
  md += `| ${t2Header.map(() => "---").join(" | ")} |\n`;

  // Reference row (baseline)
  {
    const weighted = refScore;
    const bordaVal = report.reference_calibration.reference_borda;
    const scores = critCols.map((cid) => scoreCell("reference", cid));
    const row = ["reference (baseline)", ...scores, String(round1(weighted)), `${bordaVal} pts`, "—"];
    md += `| ${row.join(" | ")} |\n`;
  }

  // AI approaches
  for (const approach of aiOnly) {
    const weighted = report.weighted_scores[approach];
    const bordaStr = bordaRankStr(approach, aiOnly, report.borda_counts);
    const gap = aiGap[approach];
    const gapStr = gap !== undefined ? (gap >= 0 ? `+${round1(gap)}` : String(round1(gap))) : "–";
    const scores = critCols.map((cid) => scoreCell(approach, cid));
    const row = [approach, ...scores, String(round1(weighted)), bordaStr, gapStr];
    md += `| ${row.join(" | ")} |\n`;
  }

  md += `
Gap to reference: ${aiApproaches.map((a) => {
    const g = aiGap[a];
    return `${a} ${g !== undefined ? (g >= 0 ? `+${round1(g)}` : String(round1(g))) : "–"}`;
  }).join(" | ")}

`;

  // ---- Per-judge details ----
  md += `## Per-Judge Details

| Judge | Model | Parse | Ranking (1st→4th) | Reasoning |
|-------|-------|-------|-------------------|-----------|
`;

  for (const j of report.judge_details) {
    const rankingStr = j.ranking_deblinded.join(" > ");
    const reasoning = (j.raw_scores.reasoning ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ")
      .slice(0, 120);
    md += `| ${j.judge_id} | ${j.model} | ${j.parse_method} | ${rankingStr} | ${reasoning}... |\n`;
  }

  md += "\n";

  // ---- Score distribution ----
  md += `## Score Distribution

`;

  for (const cr of report.criteria_results) {
    md += `### ${cr.criterion_name} (\`${cr.criterion_id}\`, ${cr.weight}x)\n\n`;
    md += `| Approach | Mean | StdDev | Min | Max |\n`;
    md += `|----------|------|--------|-----|-----|\n`;
    for (const approach of approaches4) {
      const m = cr.mean_by_approach[approach];
      const s = cr.stddev_by_approach[approach];
      const lo = cr.min_by_approach[approach];
      const hi = cr.max_by_approach[approach];
      if (m !== undefined) {
        md += `| ${approach} | ${round1(m)} | ${round1(s)} | ${lo} | ${hi} |\n`;
      }
    }
    md += "\n";
  }

  // ---- Statistical footer ----
  const st = report.statistical_tests;
  if (st) {
    md += `## Statistical Analysis

**Friedman omnibus**: χ² = ${st.friedman_statistic}, p = ${st.friedman_p}

**Wilcoxon pairwise** (Bonferroni corrected):

| Pair | p-value |
|------|---------|
`;
    for (const [pair, pval] of Object.entries(st.wilcoxon_pairwise)) {
      md += `| ${pair.replace(/_vs_/, " vs ")} | ${pval} |\n`;
    }

    md += `
**Bootstrap 95% CI** (weighted score, 1000 resamples):

| Approach | CI Low | CI High |
|----------|--------|---------|
`;
    for (const approach of approaches4) {
      const ci = st.bootstrap_ci[approach];
      if (ci) {
        md += `| ${approach} | ${ci[0]} | ${ci[1]} |\n`;
      }
    }

    md += `
---

_${st.significance_note}_

`;
  } else {
    md += `## Statistical Footer

With 7 judges, results are directional. Deltas under ~0.8 points are within
measurement noise at typical inter-judge variance (sigma ~0.9).
Statistical tests were not computed for this run.

`;
  }

  // ---- Failed judges ----
  if (report.failed_judges.length > 0) {
    md += `## Failed Judges

`;
    for (const fj of report.failed_judges) {
      md += `- ${fj}\n`;
    }
    md += "\n";
  }

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun research/tech-writer-eval/analyze-results.ts <run-dir>");
    process.exit(1);
  }

  const runDir = args[0];

  // test-cases.json lives alongside this script in research/tech-writer-eval/
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const configPath = join(scriptDir, "test-cases.json");
  const mappingPath = join(runDir, "sample-mapping.json");

  if (!existsSync(mappingPath)) {
    console.error(`ERROR: sample-mapping.json not found in ${runDir}`);
    process.exit(1);
  }
  if (!existsSync(configPath)) {
    console.error(`ERROR: test-cases.json not found at ${configPath}`);
    process.exit(1);
  }

  const mapping: SampleMapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
  const config: TestCasesConfig = JSON.parse(readFileSync(configPath, "utf-8"));

  const criteria: Criterion[] = config.evaluation.criteria;
  const criteriaIds = criteria.map((cr) => cr.id);
  const totalWeight: number = config.evaluation.total_weight; // 14.0
  const approaches: string[] = config.approaches; // ["default","techwriter","reference","gemini"]
  const judgeConfigs: JudgeConfig[] = config.judges;

  console.log(`\n${c("=== 4-Way Tech-Writer Benchmark Analyzer ===", BOLD)}`);
  console.log(`Run dir:  ${runDir}`);
  console.log(`Config:   ${configPath}`);
  console.log(`Criteria: ${criteria.length}  Total weight: ${totalWeight}`);
  console.log(`Judges:   ${judgeConfigs.length}`);
  console.log(`Approaches: ${approaches.join(", ")}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // Parse each judge's response
  // ---------------------------------------------------------------------------

  const judgeResults: JudgeResult[] = [];
  const failedJudges: string[] = [];

  for (const judge of judgeConfigs) {
    const judgeDir = join(runDir, "judge", judge.id);

    let rawText = "";
    const responsePath = join(judgeDir, "response.txt");
    const transcriptPath = join(judgeDir, "transcript.jsonl");

    if (existsSync(responsePath)) {
      rawText = readFileSync(responsePath, "utf-8");
    } else if (existsSync(transcriptPath)) {
      rawText = extractFromTranscript(transcriptPath);
    }

    if (!rawText || rawText.length < 20) {
      console.log(`  ${c("SKIP", YELLOW)} ${judge.id}: no response found`);
      failedJudges.push(judge.id);
      continue;
    }

    const parsed = parseJudgeResponse(rawText);
    if (!parsed) {
      console.log(`  ${c("FAIL", RED)} ${judge.id}: could not parse scores (${rawText.length} chars)`);
      failedJudges.push(judge.id);
      continue;
    }

    const { response: jr, method } = parsed;

    // Validate ordering exists for this judge
    const ordering = mapping.judge_orderings[judge.id];
    if (!ordering || ordering.length < 4) {
      console.log(`  ${c("FAIL", RED)} ${judge.id}: no ordering in sample-mapping.json`);
      failedJudges.push(judge.id);
      continue;
    }

    // Clamp all scores, fill missing with default=5
    const slotKeys = ["sample_a", "sample_b", "sample_c", "sample_d"] as const;
    const clampedScores: JudgeResponse["scores"] = {
      sample_a: {},
      sample_b: {},
      sample_c: {},
      sample_d: {},
    };

    for (const slot of slotKeys) {
      for (const cid of criteriaIds) {
        const raw = jr.scores?.[slot]?.[cid];
        if (raw === undefined) {
          console.log(`    ${c("WARN", YELLOW)} ${judge.id}: missing ${slot}.${cid} — defaulting to 5`);
        }
        clampedScores[slot][cid] = clamp(raw ?? 5);
      }
    }

    const clampedResponse: JudgeResponse = {
      scores: clampedScores,
      ranking: jr.ranking ?? [],
      reasoning: (jr.reasoning ?? "").toString(),
    };

    // De-blind scores
    const deblindedScores = deblindScores(clampedResponse, mapping, judge.id);

    // De-blind ranking
    const rankingRaw = clampedResponse.ranking;
    const rankingDeblinded =
      rankingRaw && rankingRaw.length === 4
        ? deblindRanking(rankingRaw, mapping, judge.id)
        : approaches.slice(); // fallback: original order

    judgeResults.push({
      judge_id: judge.id,
      model: judge.model,
      ordering,
      raw_scores: clampedResponse,
      deblinded_scores: deblindedScores,
      ranking_deblinded: rankingDeblinded,
      parse_method: method,
      raw_response_length: rawText.length,
    });

    console.log(
      `  ${c("OK  ", GREEN)} ${judge.id}: method=${method} ranking=${rankingDeblinded.join(">")} len=${rawText.length}`
    );
  }

  console.log("");

  if (judgeResults.length === 0) {
    console.error("ERROR: No judges produced parseable results.");
    process.exit(1);
  }

  const minJudges = config.thresholds.min_judges ?? 3;
  if (judgeResults.length < minJudges) {
    console.error(
      `ERROR: Only ${judgeResults.length} judges succeeded (minimum: ${minJudges}).`
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Per-criterion statistics
  // ---------------------------------------------------------------------------

  const criteriaResults: CriterionStats[] = criteria.map((criterion) => {
    const scoresByApproach: Record<string, number[]> = {};
    for (const approach of approaches) {
      scoresByApproach[approach] = [];
    }

    for (const judge of judgeResults) {
      for (const approach of approaches) {
        const score = judge.deblinded_scores[approach]?.[criterion.id];
        if (score !== undefined) {
          scoresByApproach[approach].push(score);
        }
      }
    }

    const meanByApproach: Record<string, number> = {};
    const stddevByApproach: Record<string, number> = {};
    const minByApproach: Record<string, number> = {};
    const maxByApproach: Record<string, number> = {};

    for (const approach of approaches) {
      const scores = scoresByApproach[approach];
      meanByApproach[approach] = round1(mean(scores));
      stddevByApproach[approach] = round1(stddev(scores));
      minByApproach[approach] = scores.length > 0 ? Math.min(...scores) : 0;
      maxByApproach[approach] = scores.length > 0 ? Math.max(...scores) : 0;
    }

    return {
      criterion_id: criterion.id,
      criterion_name: criterion.name,
      weight: criterion.weight,
      scores_by_approach: scoresByApproach,
      mean_by_approach: meanByApproach,
      stddev_by_approach: stddevByApproach,
      min_by_approach: minByApproach,
      max_by_approach: maxByApproach,
    };
  });

  // ---------------------------------------------------------------------------
  // Weighted overall scores
  // ---------------------------------------------------------------------------

  const weightedScores: Record<string, number> = {};
  for (const approach of approaches) {
    let total = 0;
    for (const cr of criteriaResults) {
      total += (cr.mean_by_approach[approach] ?? 0) * cr.weight;
    }
    weightedScores[approach] = round1(total / totalWeight);
  }

  // ---------------------------------------------------------------------------
  // Borda count ranking
  // ---------------------------------------------------------------------------

  const bordaCounts = computeBordaCount(judgeResults);

  // Absolute ranking: all 4, sorted by Borda (ties broken by weighted score)
  const absoluteRanking = [...approaches].sort((a, b) => {
    const bc = (bordaCounts[b] ?? 0) - (bordaCounts[a] ?? 0);
    if (bc !== 0) return bc;
    return (weightedScores[b] ?? 0) - (weightedScores[a] ?? 0);
  });

  // AI-only ranking: 3 AI approaches (exclude reference)
  const aiApproaches = approaches.filter((a) => a !== "reference");
  const aiOnlyRanking = [...aiApproaches].sort((a, b) => {
    const bc = (bordaCounts[b] ?? 0) - (bordaCounts[a] ?? 0);
    if (bc !== 0) return bc;
    return (weightedScores[b] ?? 0) - (weightedScores[a] ?? 0);
  });

  // Reference calibration
  const refScore = weightedScores["reference"] ?? 0;
  const aiGap: Record<string, number> = {};
  for (const approach of aiApproaches) {
    aiGap[approach] = round1((weightedScores[approach] ?? 0) - refScore);
  }

  // ---------------------------------------------------------------------------
  // Statistical tests
  // ---------------------------------------------------------------------------

  // Build data matrix [judge][approach] using weighted scores per judge per approach
  // (use sum of weighted criterion scores for each judge, not the global mean)
  function judgeWeightedScore(judge: JudgeResult, approach: string): number {
    let total = 0;
    for (const cr of criteriaResults) {
      const score = judge.deblinded_scores[approach]?.[cr.criterion_id] ?? 5;
      total += score * cr.weight;
    }
    return total / totalWeight;
  }

  const approachOrder = approaches;
  const friedmanData: number[][] = judgeResults.map((j) =>
    approachOrder.map((ap) => judgeWeightedScore(j, ap))
  );

  const { statistic: friedmanStat, p: friedmanP } = friedmanTest(friedmanData);

  // Wilcoxon pairwise (Bonferroni correction: multiply p by number of pairs)
  const pairs: [string, string][] = [];
  for (let i = 0; i < approaches.length; i++) {
    for (let j = i + 1; j < approaches.length; j++) {
      pairs.push([approaches[i], approaches[j]]);
    }
  }

  const wilcoxonPairwise: Record<string, number> = {};
  const bonferroniN = pairs.length;

  for (const [a, b] of pairs) {
    const aScores = judgeResults.map((j) => judgeWeightedScore(j, a));
    const bScores = judgeResults.map((j) => judgeWeightedScore(j, b));
    const rawP = wilcoxonSignedRank(aScores, bScores);
    const corrected = round2(Math.min(1, rawP * bonferroniN));
    wilcoxonPairwise[`${a}_vs_${b}`] = corrected;
  }

  // Bootstrap CI per approach using each judge's weighted score
  const bootstrapCIs: Record<string, [number, number]> = {};
  for (const approach of approaches) {
    const scores = judgeResults.map((j) => judgeWeightedScore(j, approach));
    bootstrapCIs[approach] = bootstrapCI(scores, 1000);
  }

  const significanceNote =
    `With ${judgeResults.length} judges, results are directional. ` +
    `Deltas under ~0.8 points are within measurement noise at typical inter-judge ` +
    `variance (sigma ~0.9). Wilcoxon p-values are Bonferroni corrected for ` +
    `${bonferroniN} pairs.`;

  const statisticalTests: StatisticalTests = {
    friedman_statistic: friedmanStat,
    friedman_p: friedmanP,
    wilcoxon_pairwise: wilcoxonPairwise,
    bootstrap_ci: bootstrapCIs,
    significance_note: significanceNote,
  };

  // ---------------------------------------------------------------------------
  // Console output summary
  // ---------------------------------------------------------------------------

  console.log(c("=== Results Summary ===", BOLD));
  console.log("");

  // Print criterion table header
  const critColW = 18;
  const approachColW = 12;
  const header =
    pad("Criterion", critColW) +
    approaches.map((a) => pad(a, approachColW)).join("") +
    pad("Weight", 8);
  console.log("  " + c(header, BOLD));
  console.log("  " + "─".repeat(header.length));

  for (const cr of criteriaResults) {
    const row =
      pad(cr.criterion_name.slice(0, critColW - 1), critColW) +
      approaches.map((a) => {
        const m = cr.mean_by_approach[a];
        return pad(m !== undefined ? String(m) : "–", approachColW);
      }).join("") +
      pad(`${cr.weight}x`, 8);
    console.log("  " + row);
  }

  console.log("  " + "─".repeat(header.length));

  const wRow =
    pad("WEIGHTED", critColW) +
    approaches.map((a) => {
      const w = weightedScores[a];
      return pad(w !== undefined ? String(w) : "–", approachColW);
    }).join("") +
    pad(`${totalWeight}x`, 8);
  console.log("  " + c(wRow, BOLD));

  console.log("");
  console.log(c("=== Absolute Ranking (Borda) ===", BOLD));
  absoluteRanking.forEach((approach, i) => {
    const pts = bordaCounts[approach] ?? 0;
    const ws = weightedScores[approach];
    const marker = i === 0 ? c("★", YELLOW) : " ";
    console.log(`  ${marker} ${i + 1}. ${c(pad(approach, 12), i === 0 ? GREEN : CYAN)} Borda=${pts}  Weighted=${ws}`);
  });

  console.log("");
  console.log(c("=== AI-Only Ranking ===", BOLD));
  aiOnlyRanking.forEach((approach, i) => {
    const gap = aiGap[approach];
    const gapStr = gap !== undefined ? (gap >= 0 ? `+${gap}` : String(gap)) : "–";
    const marker = i === 0 ? c("★", YELLOW) : " ";
    console.log(
      `  ${marker} ${i + 1}. ${c(pad(approach, 12), i === 0 ? GREEN : CYAN)} ` +
      `Gap vs reference: ${gapStr}`
    );
  });

  console.log("");
  console.log(
    `Friedman χ² = ${friedmanStat}  p = ${friedmanP}  (${judgeResults.length} judges, ${approaches.length} approaches)`
  );
  console.log("");

  // ---------------------------------------------------------------------------
  // Build report object
  // ---------------------------------------------------------------------------

  const report: BenchmarkReport = {
    run_dir: runDir,
    analyzed_at: new Date().toISOString(),
    topic: config.topic.title,
    sample_mapping: mapping,
    total_judges: judgeConfigs.length,
    successful_judges: judgeResults.length,
    failed_judges: failedJudges,
    criteria_results: criteriaResults,
    weighted_scores: weightedScores,
    borda_counts: bordaCounts,
    absolute_ranking: absoluteRanking,
    ai_only_ranking: aiOnlyRanking,
    reference_calibration: {
      reference_weighted_score: refScore,
      reference_borda: bordaCounts["reference"] ?? 0,
      ai_gap: aiGap,
    },
    statistical_tests: statisticalTests,
    judge_details: judgeResults,
  };

  // ---------------------------------------------------------------------------
  // Write output files
  // ---------------------------------------------------------------------------

  const reportDir = join(runDir, "report");
  mkdirSync(reportDir, { recursive: true });

  const jsonPath = join(reportDir, "tech-writer-benchmark.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`JSON report: ${jsonPath}`);

  const mdPath = join(reportDir, "tech-writer-benchmark.md");
  const md = generateMarkdownReport(report, criteria, approaches);
  writeFileSync(mdPath, md);
  console.log(`MD report:   ${mdPath}`);
  console.log("");
}

main();
