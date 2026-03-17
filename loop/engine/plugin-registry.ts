// loop/engine/plugin-registry.ts
// Static plugin registry for the experiment platform.
// To add a new experiment: import it here and add to REGISTRY.
// Static imports (not dynamic) preserve TypeScript interface verification at compile time.

import type { Experiment } from "./types.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// NOTE: Experiment plugins are imported lazily via dynamic import so this
// registry module compiles even when the experiments/ directory doesn't exist
// yet. Each loader is only invoked when the experiment is actually requested.
// Once an experiment is implemented, it can be converted to a static import.
//
// To convert to static imports (recommended once plugins exist):
//   import techWriter from "../experiments/tech-writer-quality/experiment.ts";
//   const REGISTRY: Record<string, Experiment> = { "tech-writer-quality": techWriter, ... };

const REGISTRY: Record<string, () => Promise<Experiment>> = {
  "tech-writer-quality": () =>
    import("../experiments/tech-writer-quality/experiment.ts").then(
      (m) => m.default as Experiment
    ),
  "agent-routing": () =>
    import("../experiments/agent-routing/experiment.ts").then(
      (m) => m.default as Experiment
    ),
  "prompt-cost-optimizer": () =>
    import("../experiments/prompt-cost-optimizer/experiment.ts").then(
      (m) => m.default as Experiment
    ),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the experiment plugin by its ID.
 * Throws if the experiment_id is not registered or the plugin is malformed.
 */
export async function loadExperiment(experimentId: string): Promise<Experiment> {
  const loader = REGISTRY[experimentId];
  if (!loader) {
    throw new Error(
      `Unknown experiment_id "${experimentId}". Registered: ${Object.keys(REGISTRY).join(", ")}`
    );
  }
  const plugin = await loader();
  validatePlugin(plugin);
  return plugin;
}

/**
 * Load the experiment plugin specified in loop/config.json.
 * Reads `experiment_id` from the config file and delegates to loadExperiment().
 *
 * @param loopDir  Absolute path to the loop/ directory (defaults to the canonical location)
 */
export async function getActiveExperiment(
  loopDir?: string
): Promise<Experiment> {
  const dir = loopDir ?? join(import.meta.dir, "..");
  const configPath = join(dir, "config.json");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to read loop config at ${configPath}: ${err}`);
  }

  const experimentId = config.experiment_id;
  if (typeof experimentId !== "string" || !experimentId) {
    throw new Error(
      `config.json must have a non-empty "experiment_id" field. Found: ${JSON.stringify(experimentId)}`
    );
  }

  return loadExperiment(experimentId);
}

/**
 * List all registered experiment IDs.
 */
export function listExperiments(): string[] {
  return Object.keys(REGISTRY);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePlugin(plugin: Experiment): void {
  const requiredKeys: Array<keyof Experiment> = [
    "name",
    "description",
    "run",
    "readBaseline",
    "saveBaseline",
    "isImprovement",
    "isRegression",
    "formatMetrics",
    "formatDelta",
    "formatBaseline",
    "changeableFiles",
    "contextFiles",
    "researchHints",
    "dependentVariables",
  ];

  const missingKeys: string[] = [];
  for (const key of requiredKeys) {
    if (plugin[key] == null) {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `Plugin "${(plugin as { name?: string }).name ?? "unknown"}" is missing required fields: ${missingKeys.join(", ")}`
    );
  }
}
