// loop/engine/types.ts
// Generic engine types for the A+C Hybrid Experiment Platform.
// All eval-specific types live in experiments/, not here.

// ---------------------------------------------------------------------------
// Core metrics types
// ---------------------------------------------------------------------------

/**
 * Opaque metrics blob — each plugin defines its own shape.
 * Values must be JSON-serializable.
 */
export type Metrics = Record<string, number | string | boolean | null>;

/**
 * Signal returned by isImprovement and isRegression.
 */
export interface DecisionSignal {
  /** Whether the condition (improvement or regression) was detected */
  result: boolean;
  /** Human-readable explanation for logs and journal */
  reason: string;
  /** Optional: which metric was the deciding factor */
  primaryMetric?: string;
}

// ---------------------------------------------------------------------------
// Experiment spec and result
// ---------------------------------------------------------------------------

/**
 * Spec produced by the planner agent for a single approach.
 * Extends the hypothesis with execution details.
 */
export interface ExperimentSpec {
  /** Corresponds to approach label: "a" | "b" | "c" */
  label: string;
  /** Hypothesis ID this spec implements */
  hypothesisId: string;
  /** Title for display */
  title: string;
  /** Files the implementer agent is authorized to modify (relative to repo root) */
  filesToChange: string[];
  /** What the implementer should do */
  changeDescription: string;
  /** What metric movement is expected */
  expectedDelta: string;
  /** Risk level, for merge ordering */
  riskLevel: "low" | "medium" | "high";
}

/**
 * Result produced after running an experiment.
 */
export interface ExperimentResult {
  label: string;
  hypothesisId: string | null;
  iteration: number;
  worktreePath: string | null;
  branch: string | null;
  runDir: string | null;
  status: "success" | "error" | "isolation_failed";
  error: string | null;
  metrics: Metrics | null;
  isolationViolation: IsolationViolation | null;
  regressionDetected: boolean;
}

/**
 * Recorded when the diff verifier detects unexpected file changes.
 */
export interface IsolationViolation {
  declaredFiles: string[];
  actualChangedFiles: string[];
  unexpectedFiles: string[];
}

// ---------------------------------------------------------------------------
// Experiment plugin interface
// ---------------------------------------------------------------------------

/**
 * The full Experiment interface that every plugin must implement.
 * This is the single boundary between the generic engine and any specific eval.
 */
export interface Experiment {
  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** Stable identifier used in config.json and directory names, e.g. "tech-writer-quality" */
  readonly name: string;

  /** Human-readable name used in logs, journal, banners */
  readonly description: string;

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Run the experiment against a git worktree.
   *
   * The plugin is responsible for:
   * - Invoking its eval harness (bash script, npx, etc.) inside worktreePath
   * - Parsing the output into a Metrics record
   * - Detecting hard regression (e.g. compare-baseline.sh exit code)
   *
   * @param worktreePath  Absolute path to the git worktree
   * @param outputDir     Absolute path where the plugin should write run artifacts
   * @returns             Measured metrics for this run
   * @throws              On eval harness failure (non-regression errors)
   */
  run(worktreePath: string, outputDir: string): Promise<Metrics>;

  /**
   * Read the persisted baseline for this experiment.
   * Returns null if no baseline exists (first run — engine will skip delta display).
   */
  readBaseline(): Promise<Metrics | null>;

  /**
   * Persist metrics as the new baseline after a successful merge.
   *
   * @param runDir  Absolute path to the run directory produced by run()
   *                (plugin may copy files from here to its baseline location)
   */
  saveBaseline(runDir: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Decision
  // -------------------------------------------------------------------------

  /**
   * Determine whether current metrics represent an improvement over baseline.
   *
   * This is the plugin's full decision authority — the engine accepts whatever
   * this returns. The reason string appears in logs and the journal.
   */
  isImprovement(
    current: Metrics,
    baseline: Metrics
  ): { improved: boolean; reason: string };

  /**
   * Detect hard regression — a veto condition that drops the approach regardless
   * of reviewer votes.
   */
  isRegression(
    current: Metrics,
    baseline: Metrics
  ): { regressed: boolean; reason: string };

  // -------------------------------------------------------------------------
  // Display
  // -------------------------------------------------------------------------

  /**
   * Compact one-line rendering of a metrics snapshot.
   * Used in iteration banners, logs, and journal tables.
   *
   * @example "weighted=8.1 borda=17 p=0.44"
   * @example "pass_rate=86.4% (19/22)"
   */
  formatMetrics(metrics: Metrics): string;

  /**
   * Compact one-line delta summary between two snapshots.
   * Used in journal tables and reviewer context.
   *
   * @example "weighted +0.2, borda +1, p -0.08"
   * @example "pass_rate +4.5pp (18→19/22)"
   */
  formatDelta(current: Metrics, baseline: Metrics): string;

  /**
   * Multi-line baseline summary for the iteration banner and research agent context.
   * Called at the start of each iteration with the stored baseline.
   */
  formatBaseline(): Promise<string>;

  // -------------------------------------------------------------------------
  // Research guidance
  // -------------------------------------------------------------------------

  /**
   * Glob patterns (relative to repo root) that agents are authorized to modify.
   * Injected into planner and implementer prompts as the allowed file list.
   * Also used by the diff verifier to check isolation.
   *
   * @example ["tech-writer-eval/prompts/**", "tech-writer-eval/test-cases.json"]
   */
  readonly changeableFiles: string[];

  /**
   * Files and directories that research agents may READ for context.
   * These are injected (or their paths are listed) into phase-1 prompts.
   * Research agents must NOT propose changes to files outside changeableFiles.
   */
  readonly contextFiles: string[];

  /**
   * Domain-specific hints injected into research agent prompts.
   * Explain the evaluation mechanism, known constraints, and open questions.
   */
  readonly researchHints: string[];

  // -------------------------------------------------------------------------
  // Hypothesis support
  // -------------------------------------------------------------------------

  /**
   * The metric names this experiment measures.
   * Research agents use these names when proposing hypotheses.
   * Must correspond to keys that appear in the Metrics record returned by run().
   *
   * @example ["tech_writer_borda", "tech_writer_weighted", "tech_writer_friedman_p"]
   * @example ["skill_routing_pass_rate", "skill_routing_failed_count"]
   */
  readonly dependentVariables: string[];

  /**
   * Optional: additional file patterns to always allow during diff verification
   * (e.g., lock files that may be updated as side effects).
   */
  readonly alwaysAllowedChanges?: string[];

  /**
   * Optional: decision criteria text for reviewer agent prompts.
   * If not provided, a generic description is used.
   */
  readonly decisionCriteriaText?: string;
}

// ---------------------------------------------------------------------------
// Hypothesis system
// ---------------------------------------------------------------------------

export type HypothesisStatus =
  | "proposed"          // generated by research agent, not yet selected
  | "designed"          // selected by planner, experiment spec attached
  | "running"           // worktree created, implementer running
  | "analyzing"         // eval complete, reviewer running
  | "accepted"          // merged to main, baseline updated
  | "rejected"          // dropped due to no improvement or regression
  | "inconclusive"      // ambiguous result, dropped but noted for retry
  | "isolation_failed"; // diff verifier detected extra file changes

export interface HypothesisIndependentVar {
  /** Human-readable description of what is being changed */
  description: string;
  /** Current value (before the change) */
  from: string | number | null;
  /** Proposed value (after the change) */
  to: string | number | null;
}

export interface HypothesisResult {
  verdict: "accepted" | "rejected" | "inconclusive" | "isolation_failed";
  /** Actual observed metrics from the experiment run */
  observedMetrics: Record<string, number | string | boolean | null>;
  /** Baseline metrics at time of experiment */
  baselineMetrics: Record<string, number | string | boolean | null>;
  /** Human-readable outcome explanation */
  explanation: string;
  /** Git commit SHA if merged */
  mergeCommit: string | null;
  resolvedAt: string;
}

export interface Hypothesis {
  // Identity
  id: string;                         // "h-0001", "h-0002", ... (monotonic)
  title: string;                      // One-line imperative: "Add second eval topic"

  // Experimental design
  independentVar: HypothesisIndependentVar;
  /** Metric names measured by this experiment (must be in plugin.dependentVariables) */
  dependentVars: string[];
  /**
   * Variables that must NOT change during execution.
   * These are file paths (relative to repo root).
   * The diff verifier compares this list against the actual git diff.
   */
  controlledFiles: string[];

  // Predicted outcome
  /** "increase" | "decrease" | "no_change" (for control experiments) */
  direction: "increase" | "decrease" | "no_change";
  /** Minimum effect considered meaningful (e.g., 0.05 for Friedman p delta) */
  effectSizeFloor: number | null;
  /** Point estimate of expected effect */
  effectSizeExpected: number | null;

  // Experiment execution
  /** Files the implementer agent should touch (relative to repo root) */
  filesToChange: string[];
  /** Description of the change for the implementer agent */
  changeDescription: string;

  // Lifecycle
  status: HypothesisStatus;
  proposedAt: string;                 // ISO timestamp
  proposedBy: string;                 // "research-agent-a" | "research-agent-b" | ...
  iterationBorn: number;              // which iteration proposed it
  iterationResolved: number | null;   // which iteration accepted/rejected it

  // Result (filled in post-execution)
  result: HypothesisResult | null;
}

// ---------------------------------------------------------------------------
// Loop state and config (engine-level versions)
// ---------------------------------------------------------------------------

export interface LoopState {
  loop_started_at: string;
  current_iteration: number;
  current_phase: string;
  last_completed_phase: string | null;
  last_completed_phase_at: string | null;
  consecutive_no_improvement_count: number;
  approaches_in_progress: string[];
  approaches_pending: string[];
  git_head_at_iteration_start: string | null;
  baseline_at_iteration_start: Metrics | null;
}

export interface LoopConfig {
  version: string;
  experiment_id: string;
  max_iterations: number | null;
  cost_table: Record<string, number>;
  estimated_cost_per_iteration_usd: number;
  stall_threshold_consecutive_iterations: number;
  worktree_base_dir: string;
  baseline_regression_threshold: number;
  research_priorities: string[];
  success_condition: {
    friedman_p_lt?: number;
    sustained_iterations: number;
  } | null;
}

export type ApproachLabel = "a" | "b" | "c";

// ---------------------------------------------------------------------------
// Reviewer vote (kept generic)
// ---------------------------------------------------------------------------

export interface ReviewerVote {
  label: string;
  reviewer_agent: number;
  vote: "keep" | "drop" | "conditional";
  confidence: "high" | "medium" | "low";
  primary_metric_delta: string;
  secondary_signals: string[];
  concerns: string[];
  rationale: string;
  auto_dropped: boolean;
}

export interface DecisionSummary {
  iteration: number;
  merged: string[];
  dropped: string[];
  all_dropped: boolean;
  new_baseline: Metrics | null;
  decided_at: string;
}
