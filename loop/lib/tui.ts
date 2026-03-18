/**
 * loop/lib/tui.ts — Zero-dependency ANSI TUI renderer
 *
 * Provides structured box-drawing output for the experiment loop.
 * All rendering is synchronous console.log — no cursor movement,
 * no screen clearing. This is a log stream, not an interactive TUI.
 *
 * Usage:
 *   import { renderIterationHeader, renderPhaseProgress, ... } from "./lib/tui.ts";
 */

// ---------------------------------------------------------------------------
// ANSI escape codes (no npm deps)
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const RED = `${ESC}31m`;
const YELLOW = `${ESC}33m`;
const CYAN = `${ESC}36m`;
const BLUE = `${ESC}34m`;
const MAGENTA = `${ESC}35m`;
const WHITE = `${ESC}37m`;
const BG_BLACK = `${ESC}40m`;

// ---------------------------------------------------------------------------
// Box drawing characters
// ---------------------------------------------------------------------------

const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  lt: "├",
  rt: "┤",
  cross: "┼",
};

// ---------------------------------------------------------------------------
// Terminal width detection
// ---------------------------------------------------------------------------

function termWidth(): number {
  const w = process.stdout.columns ?? 80;
  return Math.min(Math.max(w, 60), 100);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Right-pad a plain string (no ANSI codes) to exactly `len` characters. */
function pad(str: string, len: number): string {
  const visible = stripAnsi(str);
  const extra = len - visible.length;
  if (extra <= 0) return str;
  return str + " ".repeat(extra);
}

/** Truncate a plain string to maxLen characters, appending "..." if needed. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

/** Strip ANSI escape codes to measure visible string length. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Build a progress bar string: "█████░░░░░" */
function progressBar(filled: number, total: number, width: number): string {
  const filledCount = Math.round((filled / Math.max(total, 1)) * width);
  const emptyCount = width - filledCount;
  return (
    CYAN +
    "█".repeat(filledCount) +
    DIM +
    "░".repeat(emptyCount) +
    RESET
  );
}

/**
 * Draw a box with an optional title and lines of content.
 * Returns the full string (not yet printed).
 */
function box(title: string, lines: string[], width?: number): string {
  const w = width ?? termWidth();
  const inner = w - 2; // space between │ and │

  // Top border: ┌─ Title ──────────────┐
  let topBorder: string;
  if (title) {
    const titleSection = `${BOX.h} ${BOLD}${title}${RESET} `;
    const titleVisible = `${BOX.h} ${title} `;
    const remainingDashes = Math.max(0, inner - titleVisible.length);
    topBorder =
      BOX.tl + titleSection + BOX.h.repeat(remainingDashes) + BOX.tr;
  } else {
    topBorder = BOX.tl + BOX.h.repeat(inner) + BOX.tr;
  }

  // Content lines: │ content ... │
  const contentLines = lines.map((line) => {
    const visibleLen = stripAnsi(line).length;
    const padding = Math.max(0, inner - 2 - visibleLen); // 2 for leading space
    return `${BOX.v} ${line}${" ".repeat(padding)} ${BOX.v}`;
  });

  // Bottom border
  const bottomBorder = BOX.bl + BOX.h.repeat(inner) + BOX.br;

  return [topBorder, ...contentLines, bottomBorder].join("\n");
}

/** Draw a horizontal separator inside a box. */
function boxSeparator(width?: number): string {
  const w = width ?? termWidth();
  const inner = w - 2;
  return BOX.lt + BOX.h.repeat(inner) + BOX.rt;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PhaseStatus {
  name: string;
  status: "done" | "running" | "waiting" | "error";
  detail?: string;
}

export interface ApproachDisplay {
  label: string;
  status:
    | "success"
    | "error"
    | "running"
    | "waiting"
    | "isolation_failed"
    | "merged"
    | "dropped";
  title: string;
  metrics?: string;
  delta?: string;
}

export interface DecisionDisplay {
  label: string;
  outcome: "merged" | "dropped";
  reason: string;
  commit?: string;
}

// ---------------------------------------------------------------------------
// Exported render functions
// ---------------------------------------------------------------------------

/**
 * Render the top-of-iteration header box.
 *
 * Example:
 *   ┌─ Iteration 2/10 ─────────────────────────────────────┐
 *   │ tech-writer-quality                          3m 42s  │
 *   │ Baseline: TW techwriter=8.3 borda=15 p=0.66         │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderIterationHeader(
  iteration: number,
  maxIterations: number | null,
  experimentName: string,
  baseline: string,
  elapsed?: string
): void {
  const iterLabel = maxIterations
    ? `Iteration ${iteration}/${maxIterations}`
    : `Iteration ${iteration}`;

  const w = termWidth();
  const inner = w - 2;

  // Line 1: experiment name + elapsed time
  const expName = truncate(experimentName, inner - 12);
  const elapsedStr = elapsed ? `${DIM}${elapsed}${RESET}` : "";
  const elapsedVisible = elapsed ?? "";
  const namePad = inner - 2 - expName.length - elapsedVisible.length;
  const nameLine =
    BOLD + CYAN + expName + RESET + " ".repeat(Math.max(1, namePad)) + elapsedStr;

  // Line 2: baseline
  const baselineLabel = `${DIM}Baseline:${RESET} `;
  const baselineTruncated = truncate(baseline, inner - 12);
  const baselineLine = baselineLabel + baselineTruncated;

  console.log(box(iterLabel, [nameLine, baselineLine], w));
}

/**
 * Render phase progress bars.
 *
 * Example:
 *   ┌─ Phases ──────────────────────────────────────────────┐
 *   │  RESEARCH   ██████████  done (3 briefs)              │
 *   │  EXECUTE    █████░░░░░  running approach B...        │
 *   │  ANALYZE    ░░░░░░░░░░  waiting                     │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderPhaseProgress(phases: PhaseStatus[]): void {
  const w = termWidth();
  const barWidth = 10;
  const nameWidth = 10;

  const lines = phases.map((phase) => {
    const name = pad(phase.name.toUpperCase(), nameWidth);
    let bar: string;
    let statusColor: string;
    let statusText: string;

    switch (phase.status) {
      case "done":
        bar = progressBar(barWidth, barWidth, barWidth);
        statusColor = GREEN;
        statusText = "done";
        break;
      case "running":
        bar = progressBar(Math.ceil(barWidth / 2), barWidth, barWidth);
        statusColor = YELLOW;
        statusText = "running";
        break;
      case "error":
        bar = RED + "█".repeat(barWidth) + RESET;
        statusColor = RED;
        statusText = "error";
        break;
      default:
        bar = DIM + "░".repeat(barWidth) + RESET;
        statusColor = DIM;
        statusText = "waiting";
    }

    const detail = phase.detail ? ` ${truncate(phase.detail, 30)}` : "";
    const statusLine = statusColor + statusText + RESET + detail;

    return `${name}  ${bar}  ${statusLine}`;
  });

  console.log(box("Phases", lines, w));
}

/**
 * Render approach status table.
 *
 * Example:
 *   ┌─ Approaches ──────────────────────────────────────────┐
 *   │  A  ✓ success     Expand to 3 topics       Δ+0.2    │
 *   │  B  ◌ running     Add scoring anchors       ...     │
 *   │  C  ◌ waiting     Position-bias guard               │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderApproachTable(approaches: ApproachDisplay[]): void {
  const w = termWidth();
  const titleWidth = 35;

  const lines = approaches.map((a) => {
    const label = BOLD + a.label.toUpperCase() + RESET;

    let icon: string;
    let statusColor: string;
    switch (a.status) {
      case "success":
      case "merged":
        icon = GREEN + "✓" + RESET;
        statusColor = GREEN;
        break;
      case "error":
      case "dropped":
        icon = RED + "✗" + RESET;
        statusColor = RED;
        break;
      case "isolation_failed":
        icon = RED + "!" + RESET;
        statusColor = RED;
        break;
      case "running":
        icon = YELLOW + "◌" + RESET;
        statusColor = YELLOW;
        break;
      default:
        icon = DIM + "◌" + RESET;
        statusColor = DIM;
    }

    const statusStr = statusColor + pad(a.status, 14) + RESET;
    const titleStr = truncate(a.title, titleWidth);
    const titlePadded = pad(titleStr, titleWidth);

    let suffix = "";
    if (a.delta) {
      const deltaColor = a.delta.startsWith("+") ? GREEN : a.delta.startsWith("-") ? RED : WHITE;
      suffix = `  ${deltaColor}Δ${a.delta}${RESET}`;
    } else if (a.metrics) {
      suffix = `  ${DIM}${truncate(a.metrics, 18)}${RESET}`;
    }

    return `${label}  ${icon} ${statusStr} ${titlePadded}${suffix}`;
  });

  console.log(box("Approaches", lines, w));
}

/**
 * Render post-decision summary table.
 *
 * Example:
 *   ┌─ Decisions ───────────────────────────────────────────┐
 *   │  A  ✓ MERGED   → abc1234  "Expand to 3 topics"      │
 *   │  B  ✗ DROPPED  isolation violation                   │
 *   ├──────────────────────────────────────────────────────┤
 *   │  New baseline: TW=8.5 borda=16 p=0.44               │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderDecisionTable(
  decisions: DecisionDisplay[],
  newBaseline?: string
): void {
  const w = termWidth();
  const inner = w - 2;

  const lines = decisions.map((d) => {
    const label = BOLD + d.label.toUpperCase() + RESET;

    if (d.outcome === "merged") {
      const commitStr = d.commit
        ? ` ${DIM}→ ${d.commit}${RESET}`
        : "";
      const reasonStr = truncate(d.reason, 40);
      return `${label}  ${GREEN}✓ MERGED${RESET}  ${commitStr}  "${reasonStr}"`;
    } else {
      const reasonStr = truncate(d.reason, 55);
      return `${label}  ${RED}✗ DROPPED${RESET}  ${reasonStr}`;
    }
  });

  if (newBaseline) {
    const separatorLine = boxSeparator(w);
    const baselineLine = `${DIM}New baseline:${RESET} ${truncate(newBaseline, inner - 16)}`;

    const topBorder =
      BOX.tl + BOX.h + ` ${BOLD}Decisions${RESET} ` + BOX.h.repeat(inner - 11) + BOX.tr;

    const contentLines = lines.map((line) => {
      const visibleLen = stripAnsi(line).length;
      const padding = Math.max(0, inner - 2 - visibleLen);
      return `${BOX.v} ${line}${" ".repeat(padding)} ${BOX.v}`;
    });

    const baselineVisible = stripAnsi(baselineLine).length;
    const baselinePad = Math.max(0, inner - 2 - baselineVisible);
    const baselineRow = `${BOX.v} ${baselineLine}${" ".repeat(baselinePad)} ${BOX.v}`;

    const bottomBorder = BOX.bl + BOX.h.repeat(inner) + BOX.br;

    console.log(
      [topBorder, ...contentLines, separatorLine, baselineRow, bottomBorder].join("\n")
    );
  } else {
    console.log(box("Decisions", lines, w));
  }
}

/**
 * Render research brief summaries.
 *
 * Example:
 *   ┌─ Research ────────────────────────────────────────────┐
 *   │  A (methodology)  Expand to 3 documentation topics   │
 *   │  B (prompts)      Add behavioral scoring anchors     │
 *   │  C (structure)    Position-bias guard for judges      │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderResearchSummary(
  briefs: { agent: string; title: string }[]
): void {
  const w = termWidth();
  const agentWidth = 20;
  const inner = w - 2;

  const lines = briefs.map((b) => {
    const agentLabel = CYAN + pad(b.agent, agentWidth) + RESET;
    const titleStr = truncate(b.title, inner - agentWidth - 4);
    return `${agentLabel}  ${titleStr}`;
  });

  console.log(box("Research", lines, w));
}

/**
 * Render a one-line colored iteration summary.
 *
 * Example:
 *   ━━━ Iteration 2 complete: merged 2/3 │ baseline: TW=8.5 borda=16 p=0.44 ━━━
 */
export function renderIterationSummary(
  iteration: number,
  merged: number,
  total: number,
  newBaseline: string
): void {
  const w = termWidth();
  const mergedColor = merged > 0 ? GREEN : YELLOW;
  const baselineStr = truncate(newBaseline, 50);
  const content = `Iteration ${iteration} complete: ${mergedColor}merged ${merged}/${total}${RESET} ${DIM}│${RESET} baseline: ${CYAN}${baselineStr}${RESET}`;
  const contentVisible = `Iteration ${iteration} complete: merged ${merged}/${total} | baseline: ${baselineStr}`;
  const dashCount = Math.max(0, Math.floor((w - contentVisible.length - 2) / 2));
  const dashes = BOLD + DIM + "━".repeat(dashCount) + RESET;
  console.log(`${dashes} ${content} ${dashes}`);
}

/**
 * Render an error box with red border.
 *
 * Example:
 *   ┌─ Error: phase-3 ──────────────────────────────────────┐
 *   │  Approach B failed: timeout after 300s               │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderError(phase: string, message: string): void {
  const w = termWidth();
  const inner = w - 2;
  const title = `${RED}Error: ${phase}${RESET}`;
  const titleVisible = `Error: ${phase}`;
  const remainingDashes = Math.max(0, inner - titleVisible.length - 3);
  const topBorder =
    BOX.tl + BOX.h + " " + title + " " + BOX.h.repeat(remainingDashes) + BOX.tr;

  const msgLine = RED + truncate(message, inner - 4) + RESET;
  const msgVisible = truncate(stripAnsi(message), inner - 4);
  const msgPad = Math.max(0, inner - 2 - msgVisible.length);
  const contentLine = `${BOX.v} ${msgLine}${" ".repeat(msgPad)} ${BOX.v}`;

  const bottomBorder = BOX.bl + BOX.h.repeat(inner) + BOX.br;

  console.log([topBorder, contentLine, bottomBorder].join("\n"));
}

/**
 * Render hypothesis verdicts table.
 *
 * Example:
 *   ┌─ Hypotheses ──────────────────────────────────────────┐
 *   │  H-001  ✓ accepted    "Expand to 3 topics"           │
 *   │  H-002  ✗ rejected    "Add scoring anchors"           │
 *   │  H-003  ? inconclusive "Position-bias guard"          │
 *   └──────────────────────────────────────────────────────┘
 */
export function renderHypothesisVerdicts(
  verdicts: { id: string; status: string; description: string }[]
): void {
  const w = termWidth();
  const idWidth = 8;
  const statusWidth = 14;

  const lines = verdicts.map((v) => {
    const idStr = BOLD + pad(v.id, idWidth) + RESET;

    let icon: string;
    let statusColor: string;
    switch (v.status) {
      case "accepted":
        icon = GREEN + "✓" + RESET;
        statusColor = GREEN;
        break;
      case "rejected":
      case "isolation_failed":
        icon = RED + "✗" + RESET;
        statusColor = RED;
        break;
      case "inconclusive":
        icon = YELLOW + "?" + RESET;
        statusColor = YELLOW;
        break;
      default:
        icon = DIM + "·" + RESET;
        statusColor = DIM;
    }

    const statusStr = statusColor + pad(v.status, statusWidth) + RESET;
    const desc = `"${truncate(v.description, 40)}"`;
    return `${idStr}  ${icon} ${statusStr}  ${desc}`;
  });

  console.log(box("Hypotheses", lines, w));
}
