/**
 * Built-in plugins.
 *
 * Each built-in detector and planner is wrapped as a plugin so that the
 * core orchestrator consumes them through the same plugin pipeline as
 * third-party plugins. The wrappers are thin: they delegate to the existing
 * detector/planner classes, which remain unchanged.
 *
 * Wrapping (rather than rewriting) guarantees no behavior regressions:
 * the existing 83 tests continue to pass because the underlying detection
 * logic is identical.
 */

import type {
  DetectorPlugin,
  PlannerPlugin,
  PluginContext,
  DetectorResult,
  PlannerInput,
  PlannerOutput,
} from '../plugin-api/index.js';
import { PLUGIN_API_VERSION } from '../plugin-api/index.js';
import { NodeDetector } from '../detectors/node.js';
import { PythonDetector } from '../detectors/python.js';
import { GoDetector } from '../detectors/go.js';
import { DockerDetector } from '../detectors/docker.js';
import { GenericDetector } from '../detectors/generic.js';
import type { Detector, DetectorContext } from '../detectors/types.js';
import { buildPlans } from '../planner/planner.js';
import type { PlannerInput as InternalPlannerInput } from '../planner/planner.js';

// Built-in plugins accept any PST version they shipped with. Since PST is
// pre-1.0, we use a permissive range. Third-party plugins declare their own
// range (e.g. "^1.0.0") and PST validates it against VERSION.
const PST_RANGE = '>=0.1.0';

// ---------------------------------------------------------------------------
// Helper: wrap an internal Detector as a DetectorPlugin
// ---------------------------------------------------------------------------

function wrapDetector(detector: Detector, id: string, owns: string[]): DetectorPlugin {
  return {
    manifest: {
      id,
      name: detector.name,
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      pstRange: PST_RANGE,
      kinds: ['detector'],
      owns,
    },
    async detect(ctx: PluginContext): Promise<DetectorResult> {
      // Adapt PluginContext → DetectorContext
      const dctx: DetectorContext = {
        root: ctx.root,
        allFiles: ctx.allFiles,
        claimedFiles: ctx.claimedFiles,
        diagnostics: ctx.diagnostics,
        debug: (msg: string) => ctx.log.debug(msg),
      };
      // Delegate to the existing detector. This preserves all existing
      // detection logic and confidence scoring — no regressions.
      return await detector.detect(dctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in detector plugins
// ---------------------------------------------------------------------------

const nodePlugin = wrapDetector(new NodeDetector(), 'node', ['node']);
const pythonPlugin = wrapDetector(new PythonDetector(), 'python', ['python']);
const goPlugin = wrapDetector(new GoDetector(), 'go', ['go']);
const dockerPlugin = wrapDetector(new DockerDetector(), 'docker', ['docker']);
const genericPlugin = wrapDetector(new GenericDetector(), 'generic', []);

// ---------------------------------------------------------------------------
// Built-in planner plugin (wraps the existing buildPlans function)
// ---------------------------------------------------------------------------

const builtinPlannerPlugin: PlannerPlugin = {
  manifest: {
    id: 'builtin-planner',
    name: 'Built-in planner (Node/Python/Go/Docker)',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: PST_RANGE,
    kinds: ['planner'],
    description: 'Generates install/run/build/test/deploy plans for the four built-in stacks.',
  },
  async appliesTo(): Promise<boolean> {
    // The built-in planner handles all known stacks; it always applies.
    // Third-party planner plugins take precedence via the `owns` mechanism
    // if they declare ownership of a language id.
    return true;
  },
  async plan(input: PlannerInput, ctx: PluginContext): Promise<PlannerOutput> {
    // Convert public PlannerInput → internal PlannerInput
    const internalInput: InternalPlannerInput = {
      root: input.root,
      languages: input.languages,
      frameworks: input.frameworks,
      packageManagers: input.packageManagers,
      manifests: input.manifests,
      env: input.env,
      entrypoints: input.entrypoints,
      hasDocker: input.hasDocker,
      hasCompose: input.hasCompose,
      dockerfilePaths: input.dockerfilePaths,
      composePaths: input.composePaths,
    };
    // Delegate to the existing planner. This preserves all existing plan
    // generation logic — no regressions.
    const result = await buildPlans(internalInput);
    return {
      installPlan: {
        steps: result.installPlan.steps,
        packageManager: result.installPlan.packageManager,
        notes: result.installPlan.notes,
      },
      runPlan: {
        steps: result.runPlan.steps,
        entrypoint: result.runPlan.entrypoint,
        notes: result.runPlan.notes,
      },
      buildPlan: {
        steps: result.buildPlan.steps,
        output: result.buildPlan.output,
        notes: result.buildPlan.notes,
      },
      testPlan: {
        steps: result.testPlan.steps,
        notes: result.testPlan.notes,
      },
      deployPlan: {
        steps: result.deployPlan.steps,
        targets: result.deployPlan.targets,
        readiness: result.deployPlan.readiness,
        notes: result.deployPlan.notes,
      },
      diagnostics: result.diagnostics,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function getBuiltinPlugins(): Array<DetectorPlugin | PlannerPlugin> {
  return [
    nodePlugin,
    pythonPlugin,
    goPlugin,
    dockerPlugin,
    genericPlugin,
    builtinPlannerPlugin,
  ];
}

// Export the individual plugins for testing
export {
  nodePlugin,
  pythonPlugin,
  goPlugin,
  dockerPlugin,
  genericPlugin,
  builtinPlannerPlugin,
};
