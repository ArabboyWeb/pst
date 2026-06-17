import path from 'node:path';
import { globInProject, dirExists } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { combineConfidences, conf } from '../utils/confidence.js';
import { PluginManager } from '../plugins/manager.js';
import type { PlannerInput, PlannerOutput } from '../plugin-api/index.js';
import { versionOf, which } from '../utils/runtime.js';
import type {
  Diagnostic,
  ProjectScanResult,
  InstallPlan,
  RunPlan,
  BuildPlan,
  TestPlan,
  DeployPlan,
} from '../types/index.js';

/**
 * Top-level scan options.
 *
 * PST core is plugin-driven: this function delegates to the PluginManager,
 * which loads built-in detector + planner plugins (themselves registered as
 * plugins via src/plugins/builtin-registry.ts) and any third-party plugins
 * declared in pst.config.json or auto-discovered from node_modules.
 *
 * Core no longer directly imports NodeDetector, PythonDetector, GoDetector,
 * DockerDetector, or buildPlans. All detection and planning flows through
 * the plugin pipeline.
 */
export interface ScanOptions {
  /** Absolute path to the project root. */
  root: string;
  /** Skip network-touching runtime checks (binary versions). */
  offline?: boolean;
  /** Additional plugin paths to load (from CLI --plugin flag). */
  pluginPaths?: string[];
  /** Enable npm auto-discovery of pst-plugin-X packages. */
  autoDiscoverPlugins?: boolean;
  /** Skip loading built-in plugins (for tests). */
  skipBuiltinPlugins?: boolean;
}

export async function scanProject(opts: ScanOptions): Promise<ProjectScanResult> {
  const root = path.resolve(opts.root);
  logger.debug(`Scanning ${root}`);

  if (!(await dirExists(root))) {
    throw new Error(`Project root does not exist: ${root}`);
  }

  const allFiles = await globInProject(root, ['**/*']);
  logger.debug(`Discovered ${allFiles.length} files`);

  const diagnostics: Diagnostic[] = [];

  // --- Plugin pipeline -------------------------------------------------
  const pm = new PluginManager({
    root,
    autoDiscover: opts.autoDiscoverPlugins,
    extraPaths: opts.pluginPaths,
    skipBuiltin: opts.skipBuiltinPlugins,
  });
  await pm.load();
  await pm.initializeAll(root, allFiles, new Set(), diagnostics);

  // Run detector plugins (built-in + any third-party detector plugins).
  // Built-in detectors are registered as plugins in builtin-registry.ts;
  // they delegate to the original NodeDetector/PythonDetector/GoDetector/
  // DockerDetector/GenericDetector classes unchanged.
  const merged = await pm.runDetectors(root, allFiles, diagnostics);

  // Sort by confidence (primary first) — same as before migration.
  merged.languages.sort((a, b) => b.confidence.score - a.confidence.score);
  merged.packageManagers.sort((a, b) => b.confidence.score - a.confidence.score);
  merged.frameworks.sort((a, b) => b.confidence.score - a.confidence.score);

  // Dedupe entrypoints
  merged.entrypoints = Array.from(new Set(merged.entrypoints));

  // Identify Docker / Compose presence. Only root-level artifacts trigger
  // Docker/compose-driven planning; subdirectory Dockerfiles are recorded
  // as files but do not flip hasDocker.
  const dockerfilePaths = merged.manifests
    .filter((m) => m.kind === 'Dockerfile')
    .map((m) => m.path)
    .filter((p) => path.dirname(p) === '.');
  const composePaths = merged.manifests
    .filter((m) => m.kind === 'docker-compose.yml' || m.kind === 'compose.yml')
    .map((m) => m.path);
  const hasDocker = dockerfilePaths.length > 0;
  const hasCompose = composePaths.length > 0;

  // Build planner input
  const plannerInput: PlannerInput = {
    root,
    languages: merged.languages,
    frameworks: merged.frameworks,
    packageManagers: merged.packageManagers,
    manifests: merged.manifests,
    env: merged.env,
    entrypoints: merged.entrypoints,
    hasDocker,
    hasCompose,
    dockerfilePaths,
    composePaths,
  };

  // Run planner plugins. The built-in planner (registered as a plugin in
  // builtin-registry.ts) delegates to buildPlans() unchanged. Third-party
  // planners take precedence if they declare ownership.
  const plannerOutput: PlannerOutput | null = await pm.runPlanners(plannerInput, diagnostics);

  // Convert planner output to internal plan types (with defaults)
  const installPlan: InstallPlan = plannerOutput?.installPlan
    ? {
        steps: plannerOutput.installPlan.steps,
        packageManager: (plannerOutput.installPlan.packageManager as InstallPlan['packageManager']) ?? 'unknown',
        notes: plannerOutput.installPlan.notes ?? [],
      }
    : { steps: [], packageManager: 'unknown', notes: ['No planner produced an install plan.'] };

  const runPlan: RunPlan = plannerOutput?.runPlan
    ? {
        steps: plannerOutput.runPlan.steps,
        entrypoint: plannerOutput.runPlan.entrypoint,
        notes: plannerOutput.runPlan.notes ?? [],
      }
    : { steps: [], notes: ['No planner produced a run plan.'] };

  const buildPlan: BuildPlan = plannerOutput?.buildPlan
    ? {
        steps: plannerOutput.buildPlan.steps,
        output: plannerOutput.buildPlan.output,
        notes: plannerOutput.buildPlan.notes ?? [],
      }
    : { steps: [], notes: ['No planner produced a build plan.'] };

  const testPlan: TestPlan = plannerOutput?.testPlan
    ? {
        steps: plannerOutput.testPlan.steps,
        notes: plannerOutput.testPlan.notes ?? [],
      }
    : { steps: [], notes: ['No planner produced a test plan.'] };

  const deployPlan: DeployPlan = plannerOutput?.deployPlan
    ? {
        steps: plannerOutput.deployPlan.steps,
        targets: (plannerOutput.deployPlan.targets as DeployPlan['targets']) ?? ['unknown'],
        readiness: plannerOutput.deployPlan.readiness ?? 'not-ready',
        notes: plannerOutput.deployPlan.notes ?? [],
      }
    : { steps: [], targets: ['unknown'], readiness: 'not-ready', notes: ['No planner produced a deploy plan.'] };

  // Push planner diagnostics
  if (plannerOutput?.diagnostics) {
    for (const d of plannerOutput.diagnostics) diagnostics.push(d);
  }

  // Runtime checks (unless offline)
  if (!opts.offline) {
    await addRuntimeDiagnostics(merged.packageManagers, diagnostics);
  }

  // Overall confidence
  const confidences = [
    ...merged.languages.map((l) => l.confidence),
    ...merged.packageManagers.map((p) => p.confidence),
  ];
  const overall = confidences.length > 0
    ? combineConfidences(confidences, 'Aggregated across all detections')
    : conf(0, 'No supported stack detected');

  const scan: ProjectScanResult = {
    root,
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    languages: merged.languages,
    frameworks: merged.frameworks,
    packageManagers: merged.packageManagers,
    manifests: merged.manifests,
    files: merged.files,
    env: merged.env,
    entrypoints: merged.entrypoints,
    installPlan,
    runPlan,
    buildPlan,
    testPlan,
    deployPlan,
    diagnostics,
    overall,
  };

  // Shutdown plugins (best-effort)
  await pm.shutdownAll();

  return scan;
}

async function addRuntimeDiagnostics(
  pms: ProjectScanResult['packageManagers'],
  diagnostics: Diagnostic[],
): Promise<void> {
  const checked = new Set<string>();
  for (const pm of pms) {
    const binary = pm.binary.split(' ')[0]; // handle "docker compose"
    if (checked.has(binary)) continue;
    checked.add(binary);
    const found = await which(binary);
    if (!found) {
      diagnostics.push({
        severity: 'warn',
        code: `runtime.${binary}.missing`,
        message: `Required binary "${binary}" was not found on PATH.`,
        nextStep: `Install ${pm.name} before running this plan.`,
      });
    } else {
      const ver = await versionOf(binary);
      if (ver) {
        logger.debug(`${binary} found at ${found} (${ver})`);
      }
    }
  }
}
