import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import type { LoopState } from "./types.ts";

const DEFAULT_STATE: LoopState = {
  loop_started_at: new Date().toISOString(),
  current_iteration: 1,
  current_phase: "start",
  last_completed_phase: null,
  last_completed_phase_at: null,
  consecutive_no_improvement_count: 0,
  approaches_in_progress: [],
  approaches_pending: [],
  git_head_at_iteration_start: null,
  baseline_at_iteration_start: null,
};

export function readState(loopDir: string): LoopState {
  const statePath = join(loopDir, "state.json");
  if (!existsSync(statePath)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const raw = readFileSync(statePath, "utf-8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) } as LoopState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeState(loopDir: string, state: LoopState): void {
  const statePath = join(loopDir, "state.json");
  const tmpPath = join(loopDir, ".state.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, statePath);
}
