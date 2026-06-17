/**
 * Plugin manager — the single entry point the core orchestrator uses to
 * interact with plugins.
 *
 * Responsibilities:
 *  - Load plugins (builtin + config + local + auto-discovered)
 *  - Initialize plugins (with timeout + error boundary)
 *  - Run detector plugins in priority order, merge results
 *  - Run planner plugins, merge plans
 *  - Shutdown plugins at process end
 *
 * The manager never throws — all plugin failures become diagnostics.
 */

import { loadPlugins, safeInitialize, safeShutdown, safeDetect, safePlan, makePluginContext, detectorPlugins, frameworkDetectorPlugins, plannerPlugins } from './loader.js';
import type { LoadedPlugin } from './loader.js';
import type { DetectorResult, PlannerInput, PlannerOutput, PluginContext } from '../plugin-api/index.js';
import { emptyDetectorResult } from '../plugin-api/index.js';
import type { Diagnostic, DetectedLanguage, DetectedFramework, PackageManager, DetectedManifest, DetectedFile, EnvFile } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface PluginManagerOptions {
  root: string;
  autoDiscover?: boolean;
  extraPaths?: string[];
  /** Skip loading built-in plugins (for tests). */
  skipBuiltin?: boolean;
}

export class PluginManager {
  private loaded: LoadedPlugin[] = [];
  private initialized = false;
  private root: string;

  constructor(opts: PluginManagerOptions) {
    this.root = opts.root;
    this.opts = opts;
  }

  private opts: PluginManagerOptions;

  /**
   * Load all plugins. Safe to call multiple times — subsequent calls are no-ops.
   */
  async load(): Promise<void> {
    if (this.initialized) return;
    this.loaded = await loadPlugins({
      root: this.opts.root,
      autoDiscover: this.opts.autoDiscover,
      extraPaths: this.opts.extraPaths,
      skipBuiltin: this.opts.skipBuiltin,
    });
    this.initialized = true;
    const ok = this.loaded.filter((lp) => !lp.failed).length;
    const failed = this.loaded.filter((lp) => lp.failed).length;
    logger.debug(`Plugin manager: loaded ${ok} plugin(s), ${failed} failed`);
  }

  /**
   * Initialize all plugins. Called once at the start of a scan.
   */
  async initializeAll(
    root: string,
    allFiles: string[],
    claimedFiles: Set<string>,
    diagnostics: Diagnostic[],
  ): Promise<void> {
    for (const lp of this.loaded) {
      if (lp.failed) continue;
      const ctx = makePluginContext(lp, root, allFiles, claimedFiles, diagnostics);
      await safeInitialize(lp, ctx);
    }
  }

  /**
   * Run all detector plugins, merge results. Returns the merged DetectorResult.
   */
  async runDetectors(
    root: string,
    allFiles: string[],
    diagnostics: Diagnostic[],
  ): Promise<DetectorResult> {
    const claimedFiles = new Set<string>();
    const merged: DetectorResult = emptyDetectorResult();

    const detectors = detectorPlugins(this.loaded);
    for (const lp of detectors) {
      const ctx = makePluginContext(lp, root, allFiles, claimedFiles, diagnostics);
      const result = await safeDetect(lp, ctx);
      // Merge
      merged.languages.push(...result.languages);
      merged.frameworks.push(...result.frameworks);
      merged.packageManagers.push(...result.packageManagers);
      merged.manifests.push(...result.manifests);
      merged.files.push(...result.files);
      merged.env.push(...result.env);
      merged.entrypoints.push(...result.entrypoints);
    }

    return merged;
  }

  /**
   * Run planner plugins. Returns the first non-null plan output from a
   * planner that applies (built-in planner is always last resort since it
   * always applies). If multiple planners apply, the highest-priority one
   * wins and others are logged as shadowed.
   *
   * For the MVP, we use a simple "first applicable planner wins" strategy.
   * The built-in planner is registered last so third-party planners get
   * priority.
   */
  async runPlanners(
    input: PlannerInput,
    diagnostics: Diagnostic[],
  ): Promise<PlannerOutput | null> {
    const planners = plannerPlugins(this.loaded);
    // Sort: non-builtin first (third-party planners take precedence)
    const sorted = [...planners].sort((a, b) => {
      const aBuiltin = a.manifest.id === 'builtin-planner' ? 1 : 0;
      const bBuiltin = b.manifest.id === 'builtin-planner' ? 1 : 0;
      return aBuiltin - bBuiltin;
    });

    for (const lp of sorted) {
      const ctx = makePluginContext(lp, input.root, input.manifests.map((m) => m.path), new Set(), diagnostics);
      const output = await safePlan(lp, input, ctx);
      if (output) {
        if (lp.manifest.id !== 'builtin-planner') {
          logger.debug(`Planner ${lp.manifest.id} produced a plan; skipping builtin`);
        }
        return output;
      }
    }
    return null;
  }

  /**
   * Shutdown all plugins. Called at process end.
   */
  async shutdownAll(): Promise<void> {
    for (const lp of this.loaded) {
      await safeShutdown(lp);
    }
  }

  /**
   * Return all loaded plugins (for `pst plugins list`).
   */
  list(): LoadedPlugin[] {
    return this.loaded;
  }

  /**
   * Return a single plugin by id (for `pst plugins inspect`).
   */
  inspect(id: string): LoadedPlugin | undefined {
    return this.loaded.find((lp) => lp.manifest.id === id);
  }
}
