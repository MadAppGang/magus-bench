// Shared TypeScript interfaces for the Continuous Eval Improvement Loop

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
  baseline_at_iteration_start: BaselineSnapshot | null;
}

export interface BaselineSnapshot {
  tech_writer_techwriter_weighted: number | null;
  tech_writer_techwriter_borda: number | null;
  tech_writer_friedman_p: number | null;
  skill_routing_pass_rate: number | null;
}

export interface LoopConfig {
  version: string;
  max_iterations: number | null;
  cost_table: {
    tech_writer_api_call_usd: number;
    skill_routing_api_call_usd: number;
    research_agent_usd: number;
    reviewer_agent_usd: number;
  };
  estimated_cost_per_iteration_usd: number;
  stall_threshold_consecutive_iterations: number;
  worktree_base_dir: string;
  baseline_regression_threshold: number;
  primary_eval: string;
  evals_enabled: string[];
  research_priorities: string[];
  success_condition: {
    friedman_p_lt: number;
    sustained_iterations: number;
  } | null;
}

export type ApproachLabel = "a" | "b" | "c";
export type EvalTarget = "tech-writer-eval" | "skill-routing-eval" | "both" | "unknown";
export type ApproachStatus = "success" | "error" | "degraded";

export interface TechWriterMetrics {
  weighted_scores: Record<string, number>;
  borda_counts: Record<string, number>;
  friedman_p: number | null;
  bootstrap_ci: Record<string, [number, number]> | null;
}

export interface SkillRoutingMetrics {
  pass_rate: number;
  total_tests: number;
  passed: number;
  failed: number;
  failed_test_ids: string[];
}

export type EvalMetrics = TechWriterMetrics | SkillRoutingMetrics | null;

export interface TWBaselineDeltas {
  techwriter_weighted: number | null;
  techwriter_borda: number | null;
  friedman_p_delta: number | null;
  [key: string]: number | null;
}

export interface SRBaselineDeltas {
  pass_rate_delta: number | null;
}

export type BaselineDeltas = TWBaselineDeltas | SRBaselineDeltas | null;

export interface ApproachResult {
  approach: ApproachLabel;
  iteration: number;
  worktree_path: string | null;
  branch: string | null;
  target_eval: EvalTarget;
  run_dir: string | null;
  status: ApproachStatus;
  error: string | null;
  metrics: EvalMetrics;
  baseline_deltas: BaselineDeltas;
  regression_detected: boolean;
}

export interface ReviewerVote {
  approach: ApproachLabel;
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
  merged: ApproachLabel[];
  dropped: ApproachLabel[];
  all_dropped: boolean;
  new_tw_baseline: Record<string, unknown> | null;
  new_sr_baseline: Record<string, unknown> | null;
  decided_at: string;
}

export interface ApproachSpec {
  label: ApproachLabel;
  title: string;
  target_eval: EvalTarget;
  files_to_change: string[];
  change_description: string;
  expected_metric_delta: string;
  risk_level: "low" | "medium" | "high";
  estimated_run_time_minutes: number;
}

export interface ResearchBrief {
  agent: "A" | "B" | "C";
  proposals: Array<{
    change_description: string;
    target_files: string[];
    expected_mechanism: string;
    risks: string;
  }>;
}
