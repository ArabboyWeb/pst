import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as semver from './semver-lite.js';
import { logger } from '../utils/logger.js';
import { VERSION } from '../cli/version.js';
import type {
  AnyPlugin,
  PluginManifest,
  PluginContext,
  PluginLogger,
  DetectorPlugin,
  PlannerPlugin,
  InstallerPlugin,
  RunnerPlugin,
  DeployerPlugin,
} from '../plugin-api/index.js';
import { PLUGIN_API_VERSION } from '../plugin-api/index.js';
import type { Diagnostic } from '../types/index.js';

/**
 * A loaded plugin instance, with bookkeeping for lifecycle management.
 */
export interface LoadedPlugin {
  plugin: AnyPlugin;
  manifest: PluginManifest;
  /** Source: 'builtin' | 'config' | 'local' | 'auto' */
  source: 'builtin' | 'config' | 'local' | 'auto';
  /** Where the plugin was loaded from (path or package name). */
  sourcePath: string;
  /** Whether initialize() has been called. */
  initialized: boolean;
  /** Whether the plugin failed to load or initialize. */
  failed: boolean;
  /** Failure reason, if any. */
  failureReason?: string;
}

export interface LoadOptions {
  /** Project root (for finding pst.config.json and local plugins). */
  root: string;
  /** Explicitly enable npm auto-discovery (default: false for fast startup). */
  autoDiscover?: boolean;
  /** Additional plugin paths to load (e.g. from CLI flag). */
  extraPaths?: string[];
  /** Skip loading built-in plugins (for tests). */
  skipBuiltin?: boolean;
}

/**
 * Load all plugins for a project scan. Precedence (highest first):
 *   1. config (pst.config.json)
 *   2. local paths (from config or CLI)
 *   3. auto-discovered npm packages (opt-in)
 *   4. built-in plugins
 *
 * Higher-precedence plugins shadow lower-precedence ones by `owns` claim.
 */
export async function loadPlugins(opts: LoadOptions): Promise<LoadedPlugin[]> {
  const loaded: LoadedPlugin[] = [];
  const seenIds = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  // 1. Built-in plugins (always loaded unless explicitly skipped)
  if (!opts.skipBuiltin) {
    for (const plugin of getBuiltinPlugins()) {
      const lp = await safeLoad(plugin, 'builtin', '(builtin)', diagnostics);
      if (lp && !seenIds.has(lp.manifest.id)) {
        loaded.push(lp);
        seenIds.add(lp.manifest.id);
      }
    }
  }

  // 2. Config file (pst.config.json)
  const config = readConfig(opts.root);
  if (config) {
    for (const entry of config.plugins) {
      const lp = await loadFromEntry(entry, opts.root, 'config', diagnostics);
      if (lp && !seenIds.has(lp.manifest.id)) {
        loaded.push(lp);
        seenIds.add(lp.manifest.id);
      } else if (lp && seenIds.has(lp.manifest.id)) {
        // Higher-precedence config plugin shadows a lower one — replace.
        const idx = loaded.findIndex((p) => p.manifest.id === lp.manifest.id);
        if (idx >= 0) {
          diagnostics.push({
            severity: 'info',
            code: 'plugin.shadow',
            message: `Plugin "${lp.manifest.id}" from config shadows the ${loaded[idx].source} version.`,
          });
          loaded[idx] = lp;
        }
      }
    }
  }

  // 3. Extra paths (CLI flag)
  if (opts.extraPaths) {
    for (const entry of opts.extraPaths) {
      const lp = await loadFromEntry(entry, opts.root, 'local', diagnostics);
      if (lp && !seenIds.has(lp.manifest.id)) {
        loaded.push(lp);
        seenIds.add(lp.manifest.id);
      }
    }
  }

  // 4. Auto-discovery (opt-in only — slow)
  if (opts.autoDiscover) {
    const discovered = discoverNpmPlugins();
    for (const name of discovered) {
      const lp = await loadFromEntry(name, opts.root, 'auto', diagnostics);
      if (lp && !seenIds.has(lp.manifest.id)) {
        loaded.push(lp);
        seenIds.add(lp.manifest.id);
      }
    }
  }

  // Validate API version + PST range for every loaded plugin
  for (const lp of loaded) {
    const versionDiag = validateCompatibility(lp.manifest);
    if (versionDiag) {
      lp.failed = true;
      lp.failureReason = versionDiag.message;
      diagnostics.push(versionDiag);
    }
  }

  // Log diagnostics (these are loader-level, not scan-level)
  for (const d of diagnostics) {
    if (d.severity === 'error') logger.error(`[plugin] ${d.message}`);
    else if (d.severity === 'warn') logger.warn(`[plugin] ${d.message}`);
    else logger.debug(`[plugin] ${d.message}`);
  }

  return loaded.filter((lp) => !lp.failed || true); // keep failed ones so `list` can show them
}

// ---------------------------------------------------------------------------
// Config file
// ---------------------------------------------------------------------------

interface PstConfig {
  plugins: string[];
  /** Reserved for future options. */
  [key: string]: unknown;
}

function readConfig(root: string): PstConfig | null {
  const configPath = path.join(root, 'pst.config.json');
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as PstConfig;
    if (!Array.isArray(parsed.plugins)) {
      logger.warn(`pst.config.json at ${configPath} has no "plugins" array; ignoring.`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`Failed to parse pst.config.json: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Loading from a single entry (package name or local path)
// ---------------------------------------------------------------------------

async function loadFromEntry(
  entry: string,
  root: string,
  source: 'config' | 'local' | 'auto',
  diagnostics: Diagnostic[],
): Promise<LoadedPlugin | null> {
  // Local path (starts with ./ or ../ or / or Windows drive letter)
  if (entry.startsWith('./') || entry.startsWith('../') || path.isAbsolute(entry)) {
    const absPath = path.resolve(root, entry);
    return loadFromLocalPath(absPath, source, diagnostics);
  }
  // npm package
  return loadFromNpmPackage(entry, source, diagnostics);
}

async function loadFromLocalPath(
  absPath: string,
  source: 'config' | 'local' | 'auto',
  diagnostics: Diagnostic[],
): Promise<LoadedPlugin | null> {
  try {
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    const plugin = extractPlugin(mod);
    if (!plugin) {
      diagnostics.push({
        severity: 'error',
        code: 'plugin.no-export',
        message: `Local plugin at ${absPath} did not export a plugin object.`,
        nextStep: 'Ensure the module has a default export or named export `plugin` of type AnyPlugin.',
      });
      return null;
    }
    return await safeLoad(plugin, source, absPath, diagnostics);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'plugin.load-failed',
      message: `Failed to load local plugin at ${absPath}: ${(err as Error).message}`,
    });
    return null;
  }
}

async function loadFromNpmPackage(
  name: string,
  source: 'config' | 'local' | 'auto',
  diagnostics: Diagnostic[],
): Promise<LoadedPlugin | null> {
  try {
    // Use createRequire so we can require() from the project root, not from
    // PST's own node_modules. This is what allows plugins installed in the
    // user's project to be found.
    const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
    const mod = projectRequire(name);
    const plugin = extractPlugin(mod);
    if (!plugin) {
      diagnostics.push({
        severity: 'error',
        code: 'plugin.no-export',
        message: `npm package "${name}" did not export a plugin object.`,
        nextStep: `Ensure the package's main export is an AnyPlugin object.`,
      });
      return null;
    }
    const pkgJson = projectRequire(`${name}/package.json`) as { version?: string };
    return await safeLoad(plugin, source, `${name}@${pkgJson.version ?? 'unknown'}`, diagnostics);
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      code: 'plugin.load-failed',
      message: `Failed to load npm plugin "${name}": ${(err as Error).message}`,
      nextStep: `Run \`npm install ${name}\` in your project, or check the package name.`,
    });
    return null;
  }
}

function extractPlugin(mod: unknown): AnyPlugin | null {
  if (!mod || typeof mod !== 'object') return null;
  // Default export
  const def = (mod as { default?: unknown }).default;
  if (isPlugin(def)) return def as AnyPlugin;
  // Named export `plugin`
  const named = (mod as { plugin?: unknown }).plugin;
  if (isPlugin(named)) return named as AnyPlugin;
  // The module itself is the plugin
  if (isPlugin(mod)) return mod as AnyPlugin;
  return null;
}

function isPlugin(v: unknown): v is AnyPlugin {
  if (!v || typeof v !== 'object') return false;
  const m = (v as { manifest?: unknown }).manifest;
  if (!m || typeof m !== 'object') return false;
  const manifest = m as PluginManifest;
  return (
    typeof manifest.id === 'string' &&
    typeof manifest.name === 'string' &&
    typeof manifest.version === 'string' &&
    typeof manifest.apiVersion === 'number' &&
    typeof manifest.pstRange === 'string' &&
    Array.isArray(manifest.kinds)
  );
}

// ---------------------------------------------------------------------------
// Safe load (with manifest validation)
// ---------------------------------------------------------------------------

async function safeLoad(
  plugin: AnyPlugin,
  source: 'builtin' | 'config' | 'local' | 'auto',
  sourcePath: string,
  diagnostics: Diagnostic[],
): Promise<LoadedPlugin | null> {
  const manifest = plugin.manifest;
  // Basic manifest validation
  if (!manifest.id || !manifest.name || !manifest.version) {
    diagnostics.push({
      severity: 'error',
      code: 'plugin.invalid-manifest',
      message: `Plugin from ${sourcePath} has an invalid manifest (missing id, name, or version).`,
    });
    return null;
  }
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    diagnostics.push({
      severity: 'error',
      code: 'plugin.api-version-mismatch',
      message: `Plugin "${manifest.id}" targets API version ${manifest.apiVersion} but PST supports ${PLUGIN_API_VERSION}.`,
      nextStep: 'Update the plugin to target the current API version, or upgrade PST.',
    });
    // Still return the LoadedPlugin so `plugins list` can show it as failed.
    return {
      plugin,
      manifest,
      source,
      sourcePath,
      initialized: false,
      failed: true,
      failureReason: `apiVersion mismatch (plugin: ${manifest.apiVersion}, PST: ${PLUGIN_API_VERSION})`,
    };
  }
  return {
    plugin,
    manifest,
    source,
    sourcePath,
    initialized: false,
    failed: false,
  };
}

// ---------------------------------------------------------------------------
// Version compatibility
// ---------------------------------------------------------------------------

function validateCompatibility(manifest: PluginManifest): Diagnostic | null {
  // pstRange is a semver range like "^1.0.0". PST's version is VERSION.
  try {
    if (!semver.satisfies(VERSION, manifest.pstRange)) {
      return {
        severity: 'error',
        code: 'plugin.pst-range-mismatch',
        message: `Plugin "${manifest.id}" requires PST ${manifest.pstRange} but PST is ${VERSION}.`,
        nextStep: 'Upgrade/downgrade PST or the plugin to a compatible version.',
      };
    }
  } catch (err) {
    return {
      severity: 'warn',
      code: 'plugin.invalid-pst-range',
      message: `Plugin "${manifest.id}" has an invalid pstRange "${manifest.pstRange}": ${(err as Error).message}. Plugin will still load.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-discovery
// ---------------------------------------------------------------------------

/**
 * Scan node_modules for packages named pst-plugin-X or @scope/pst-plugin-X.
 * Returns package names. Does NOT load them — the caller does that.
 *
 * This is opt-in because scanning node_modules is slow on large projects.
 */
function discoverNpmPlugins(): string[] {
  const found: string[] = [];
  try {
    const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
    const paths = projectRequire.resolve.paths('') ?? [];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      // Scan top-level node_modules
      const entries = safeReadDir(p);
      for (const entry of entries) {
        if (entry.startsWith('pst-plugin-')) {
          found.push(entry);
        }
      }
      // Scan scoped packages @scope/pst-plugin-*
      for (const entry of entries) {
        if (entry.startsWith('@')) {
          const scopedPath = path.join(p, entry);
          const scopedEntries = safeReadDir(scopedPath);
          for (const se of scopedEntries) {
            if (se.startsWith('pst-plugin-')) {
              found.push(`${entry}/${se}`);
            }
          }
        }
      }
    }
  } catch (err) {
    logger.debug(`Auto-discovery failed: ${(err as Error).message}`);
  }
  return found;
}

function safeReadDir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Built-in plugins (lazy getter — avoids circular imports at module load)
// ---------------------------------------------------------------------------

import { getBuiltinPlugins } from './builtin-registry.js';

// ---------------------------------------------------------------------------
// Lifecycle: initialize / shutdown (with timeout + error boundary)
// ---------------------------------------------------------------------------

const LIFECYCLE_TIMEOUT = 5_000; // 5s for initialize/shutdown
const DETECT_TIMEOUT = 10_000;   // 10s for detect/plan

/**
 * Build a PluginContext for a specific plugin, with a scoped logger.
 */
export function makePluginContext(
  lp: LoadedPlugin,
  root: string,
  allFiles: string[],
  claimedFiles: Set<string>,
  diagnostics: Diagnostic[],
): PluginContext {
  const prefix = `[plugin:${lp.manifest.id}]`;
  const scoped: PluginLogger = {
    debug: (msg, ...rest) => logger.debug(`${prefix} ${msg}`, ...rest),
    info: (msg, ...rest) => logger.info(`${prefix} ${msg}`, ...rest),
    warn: (msg, ...rest) => logger.warn(`${prefix} ${msg}`, ...rest),
    error: (msg, ...rest) => logger.error(`${prefix} ${msg}`, ...rest),
  };
  return {
    root,
    allFiles,
    claimedFiles,
    diagnostics,
    log: scoped,
    pstVersion: VERSION,
  };
}

/**
 * Call a plugin's initialize() with timeout + error boundary.
 * Never throws.
 */
export async function safeInitialize(lp: LoadedPlugin, ctx: PluginContext): Promise<void> {
  if (lp.initialized || lp.failed) return;
  if (typeof lp.plugin.initialize !== 'function') {
    lp.initialized = true;
    return;
  }
  try {
    await withTimeout(lp.plugin.initialize(ctx), LIFECYCLE_TIMEOUT, `initialize:${lp.manifest.id}`);
    lp.initialized = true;
    logger.debug(`Initialized plugin ${lp.manifest.id} from ${lp.source}`);
  } catch (err) {
    lp.failed = true;
    lp.failureReason = `initialize() failed: ${(err as Error).message}`;
    ctx.diagnostics.push({
      severity: 'error',
      code: 'plugin.initialize-failed',
      message: `Plugin "${lp.manifest.id}" failed to initialize: ${(err as Error).message}`,
      nextStep: 'The plugin will be skipped for this scan. Check the plugin\'s setup requirements.',
    });
  }
}

/**
 * Call a plugin's shutdown() with timeout + error boundary.
 * Never throws.
 */
export async function safeShutdown(lp: LoadedPlugin): Promise<void> {
  if (typeof lp.plugin.shutdown !== 'function') return;
  try {
    await withTimeout(lp.plugin.shutdown(), LIFECYCLE_TIMEOUT, `shutdown:${lp.manifest.id}`);
  } catch (err) {
    logger.debug(`Plugin ${lp.manifest.id} shutdown failed: ${(err as Error).message}`);
  }
}

/**
 * Call a detector plugin's detect() with timeout + error boundary.
 * Returns an empty result on failure. Never throws.
 */
export async function safeDetect(
  lp: LoadedPlugin,
  ctx: PluginContext,
): Promise<import('../plugin-api/index.js').DetectorResult> {
  const { emptyDetectorResult } = await import('../plugin-api/index.js');
  if (lp.failed) return emptyDetectorResult();
  if (!('detect' in lp.plugin) || typeof lp.plugin.detect !== 'function') {
    return emptyDetectorResult();
  }
  try {
    const result = await withTimeout(
      (lp.plugin as DetectorPlugin).detect(ctx),
      DETECT_TIMEOUT,
      `detect:${lp.manifest.id}`,
    );
    return result ?? emptyDetectorResult();
  } catch (err) {
    ctx.diagnostics.push({
      severity: 'warn',
      code: 'plugin.detect-failed',
      message: `Detector plugin "${lp.manifest.id}" failed: ${(err as Error).message}`,
      nextStep: 'The plugin was skipped. Other detectors ran normally.',
    });
    return emptyDetectorResult();
  }
}

/**
 * Call a planner plugin's appliesTo() + plan() with timeout + error boundary.
 * Returns null if the plugin doesn't apply or failed. Never throws.
 */
export async function safePlan(
  lp: LoadedPlugin,
  input: import('../plugin-api/index.js').PlannerInput,
  ctx: PluginContext,
): Promise<import('../plugin-api/index.js').PlannerOutput | null> {
  if (lp.failed) return null;
  if (!('appliesTo' in lp.plugin) || !('plan' in lp.plugin)) return null;
  const planner = lp.plugin as PlannerPlugin;
  try {
    const applies = await withTimeout(
      planner.appliesTo(input),
      DETECT_TIMEOUT,
      `appliesTo:${lp.manifest.id}`,
    );
    if (!applies) return null;
    const result = await withTimeout(
      planner.plan(input, ctx),
      DETECT_TIMEOUT,
      `plan:${lp.manifest.id}`,
    );
    return result;
  } catch (err) {
    ctx.diagnostics.push({
      severity: 'warn',
      code: 'plugin.plan-failed',
      message: `Planner plugin "${lp.manifest.id}" failed: ${(err as Error).message}`,
      nextStep: 'The plugin was skipped. Other planners ran normally.',
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Accessors for typed plugin subsets
// ---------------------------------------------------------------------------

export function detectorPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: DetectorPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('detector') && 'detect' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: DetectorPlugin }>;
}

export function frameworkDetectorPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: DetectorPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('framework-detector') && 'detect' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: DetectorPlugin }>;
}

export function plannerPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: PlannerPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('planner') && 'plan' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: PlannerPlugin }>;
}

export function installerPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: InstallerPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('installer') && 'install' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: InstallerPlugin }>;
}

export function runnerPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: RunnerPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('runner') && 'run' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: RunnerPlugin }>;
}

export function deployerPlugins(plugins: LoadedPlugin[]): Array<LoadedPlugin & { plugin: DeployerPlugin }> {
  return plugins.filter(
    (lp) => !lp.failed && lp.manifest.kinds.includes('deployer') && 'deploy' in lp.plugin,
  ) as Array<LoadedPlugin & { plugin: DeployerPlugin }>;
}
