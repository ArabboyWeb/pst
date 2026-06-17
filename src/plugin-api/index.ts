/**
 * PST Plugin API — public, versioned contract for third-party plugins.
 *
 * Plugin authors import from `pst/plugin-api`:
 *
 * ```ts
 * import { defineDetectorPlugin } from 'pst/plugin-api';
 * ```
 *
 * Versioning: every plugin declares `apiVersion: 1`. PST checks this before
 * loading. When the API changes in a backwards-incompatible way, we bump to
 * `apiVersion: 2` and support both during a transition window.
 */

// ---------------------------------------------------------------------------
// Shared types (re-exported from core types so plugins don't need a second
// import path for the data model)
// ---------------------------------------------------------------------------

export type {
  Confidence,
  ConfidenceLevel,
  DetectedLanguage,
  DetectedFramework,
  DetectedManifest,
  DetectedFile,
  EnvFile,
  EnvVar,
  PackageManager,
  PackageManagerId,
  LanguageId,
  FrameworkId,
  ManifestKind,
  PlannedCommand,
  InstallPlan,
  RunPlan,
  BuildPlan,
  TestPlan,
  DeployPlan,
  DeployTarget,
  Diagnostic,
  DiagnosticSeverity,
  ProjectScanResult,
  ExecutionRequest,
  ExecutionResult,
} from '../types/index.js';

import type {
  DetectedLanguage,
  DetectedFramework,
  DetectedManifest,
  DetectedFile,
  EnvFile,
  PackageManager,
  PlannedCommand,
  Diagnostic,
  ProjectScanResult,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// API version
// ---------------------------------------------------------------------------

/**
 * The current PST Plugin API version. Plugins must declare this in their
 * manifest. PST refuses to load plugins whose apiVersion it does not support.
 */
export const PLUGIN_API_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Confidence helper (re-exported so plugins don't need a separate import)
// ---------------------------------------------------------------------------

export { conf, combineConfidences } from '../utils/confidence.js';

/**
 * PST versions this plugin is compatible with, expressed as a semver range
 * (e.g. "^1.0.0"). PST validates the range against its own version before
 * loading. If the range does not match, PST emits a diagnostic and skips
 * the plugin.
 */
export type PstVersionRange = string;

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

/**
 * The kind of contribution a plugin makes. A single plugin can implement
 * multiple kinds (e.g. a Rust plugin that both detects Cargo.toml AND plans
 * cargo install/run/build/test).
 */
export type PluginKind =
  | 'detector'           // language / stack detection
  | 'framework-detector' // framework-level detection (Next.js, Django, etc.)
  | 'planner'            // install/run/build/test/deploy plan generation
  | 'installer'          // execute install commands (replaces planner install step)
  | 'runner'             // execute run commands
  | 'deployer';          // execute deploy commands

/**
 * Static metadata every plugin must declare. This is what `pst plugins list`
 * and `pst plugins inspect` display.
 */
export interface PluginManifest {
  /** Globally unique plugin id, e.g. "rust" or "@my-org/rust". */
  id: string;
  /** Human-facing name, e.g. "Rust detector". */
  name: string;
  /** Plugin semver, e.g. "1.0.0". */
  version: string;
  /** API version this plugin targets. Must equal PLUGIN_API_VERSION. */
  apiVersion: typeof PLUGIN_API_VERSION;
  /** Semver range of PST versions this plugin supports, e.g. "^1.0.0". */
  pstRange: PstVersionRange;
  /** Kinds this plugin implements. */
  kinds: PluginKind[];
  /** Short description for `pst plugins list`. */
  description?: string;
  /** Plugin author, for attribution. */
  author?: string;
  /** Homepage / repo URL. */
  homepage?: string;
  /**
   * Optional: the language/framework id this plugin owns. When two plugins
   * claim the same id, PST keeps the higher-priority one (config > local >
   * auto-discovered > builtin) and emits a diagnostic for the loser.
   */
  owns?: string[];
}

// ---------------------------------------------------------------------------
// Plugin context (passed to lifecycle hooks)
// ---------------------------------------------------------------------------

/**
 * Context passed to every plugin lifecycle hook. Plugins receive this
 * instead of raw access to PST internals, so we can evolve the internal
 * API without breaking plugins.
 */
export interface PluginContext {
  /** Absolute path to the project root being scanned. */
  root: string;
  /** All files (relative paths) that fast-glob returned for the project. */
  allFiles: string[];
  /** Files already claimed by a higher-priority plugin. */
  claimedFiles: Set<string>;
  /** Diagnostics accumulator — plugins may push warnings/errors here. */
  diagnostics: Diagnostic[];
  /** Logger scoped to this plugin. Writes to stderr at the configured level. */
  log: PluginLogger;
  /** PST's own version, for plugins that need runtime version checks. */
  pstVersion: string;
}

export interface PluginLogger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Detector plugins
// ---------------------------------------------------------------------------

/**
 * Result returned by a detector plugin. Same shape as the internal
 * `DetectorResult`, but exposed publicly and versioned.
 */
export interface DetectorResult {
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: PackageManager[];
  manifests: DetectedManifest[];
  files: DetectedFile[];
  env: EnvFile[];
  entrypoints: string[];
}

/**
 * A detector plugin identifies languages, frameworks, package managers,
 * manifests, env files, and entrypoints in a project.
 */
export interface DetectorPlugin {
  manifest: PluginManifest & { kinds: Array<'detector' | 'framework-detector'> };
  /** Called once when the plugin is loaded. Use for one-time setup. */
  initialize?(ctx: PluginContext): Promise<void>;
  /** Run detection. Must never throw — wrap failures in diagnostics. */
  detect(ctx: PluginContext): Promise<DetectorResult>;
  /** Optional: validate that the plugin can satisfy its claims (e.g. binary present). */
  validate?(ctx: PluginContext): Promise<PluginValidationResult>;
  /** Called once when PST shuts down. Use for cleanup. */
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Planner plugins
// ---------------------------------------------------------------------------

/**
 * Input to a planner plugin — the merged detection results from all
 * detector plugins, plus environment context.
 */
export interface PlannerInput {
  root: string;
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: PackageManager[];
  manifests: DetectedManifest[];
  env: EnvFile[];
  entrypoints: string[];
  /** True if a root Dockerfile exists. */
  hasDocker: boolean;
  /** True if a root compose file exists. */
  hasCompose: boolean;
  /** Root Dockerfile paths (empty if none). */
  dockerfilePaths: string[];
  /** Root compose file paths (empty if none). */
  composePaths: string[];
}

/**
 * Output of a planner plugin — the five plans. A plugin may fill only the
 * plans it cares about; PST merges plans across plugins in priority order.
 */
export interface PlannerOutput {
  installPlan?: {
    steps: PlannedCommand[];
    packageManager?: string;
    notes?: string[];
  };
  runPlan?: {
    steps: PlannedCommand[];
    entrypoint?: string;
    notes?: string[];
  };
  buildPlan?: {
    steps: PlannedCommand[];
    output?: string;
    notes?: string[];
  };
  testPlan?: {
    steps: PlannedCommand[];
    notes?: string[];
  };
  deployPlan?: {
    steps: PlannedCommand[];
    targets?: string[];
    readiness?: 'ready' | 'partial' | 'not-ready';
    notes?: string[];
  };
  /** Diagnostics the planner wants to surface. */
  diagnostics?: Diagnostic[];
}

/**
 * A planner plugin converts detection results into install/run/build/test/
 * deploy plans. A planner typically owns one language (e.g. the Rust
 * planner only fires when Rust is the primary language).
 */
export interface PlannerPlugin {
  manifest: PluginManifest & { kinds: ['planner'] };
  initialize?(ctx: PluginContext): Promise<void>;
  /**
   * Return true if this planner should run for the given input. PST calls
   * this before `plan()` to decide which planner(s) to invoke.
   */
  appliesTo(input: PlannerInput): Promise<boolean>;
  /** Generate plans. Must never throw. */
  plan(input: PlannerInput, ctx: PluginContext): Promise<PlannerOutput>;
  validate?(ctx: PluginContext): Promise<PluginValidationResult>;
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Installer / Runner / Deployer plugins
// ---------------------------------------------------------------------------

/**
 * An installer plugin executes install commands. Most plugins won't need
 * this — the default executor is sufficient. Installer plugins are for
 * cases like "install via Nix shell" or "install via devcontainer".
 */
export interface InstallerPlugin {
  manifest: PluginManifest & { kinds: ['installer'] };
  initialize?(ctx: PluginContext): Promise<void>;
  /** Return true if this installer should handle the given plan. */
  appliesTo(input: PlannerInput, installPlan: PlannerOutput['installPlan']): Promise<boolean>;
  /** Execute the install. Returns exit code and output. */
  install(
    input: PlannerInput,
    installPlan: PlannerOutput['installPlan'],
    ctx: PluginContext,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  validate?(ctx: PluginContext): Promise<PluginValidationResult>;
  shutdown?(): Promise<void>;
}

/**
 * A runner plugin executes run commands. Like installers, most plugins
 * won't need this.
 */
export interface RunnerPlugin {
  manifest: PluginManifest & { kinds: ['runner'] };
  initialize?(ctx: PluginContext): Promise<void>;
  appliesTo(input: PlannerInput, runPlan: PlannerOutput['runPlan']): Promise<boolean>;
  run(
    input: PlannerInput,
    runPlan: PlannerOutput['runPlan'],
    ctx: PluginContext,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  validate?(ctx: PluginContext): Promise<PluginValidationResult>;
  shutdown?(): Promise<void>;
}

/**
 * A deployer plugin executes deploy commands. Deployer plugins are useful
 * for platform-specific deploys (Vercel, Fly, Railway, etc.) that need
 * more than a shell command.
 */
export interface DeployerPlugin {
  manifest: PluginManifest & { kinds: ['deployer'] };
  initialize?(ctx: PluginContext): Promise<void>;
  appliesTo(input: PlannerInput, deployPlan: PlannerOutput['deployPlan']): Promise<boolean>;
  deploy(
    input: PlannerInput,
    deployPlan: PlannerOutput['deployPlan'],
    ctx: PluginContext,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  validate?(ctx: PluginContext): Promise<PluginValidationResult>;
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Union type and validation
// ---------------------------------------------------------------------------

export type AnyPlugin =
  | DetectorPlugin
  | PlannerPlugin
  | InstallerPlugin
  | RunnerPlugin
  | DeployerPlugin;

export interface PluginValidationResult {
  ok: boolean;
  /** Diagnostics explaining why the plugin is not satisfied, if !ok. */
  diagnostics?: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Helper: define plugins with type inference
// ---------------------------------------------------------------------------

/**
 * Define a detector plugin with full type checking. Recommended entry point
 * for plugin authors.
 *
 * ```ts
 * export default defineDetectorPlugin({
 *   manifest: { id: 'rust', name: 'Rust', version: '1.0.0', apiVersion: 1, pstRange: '^1.0.0', kinds: ['detector'] },
 *   async detect(ctx) { ... },
 * });
 * ```
 */
export function defineDetectorPlugin(plugin: DetectorPlugin): DetectorPlugin {
  return plugin;
}

export function definePlannerPlugin(plugin: PlannerPlugin): PlannerPlugin {
  return plugin;
}

export function defineInstallerPlugin(plugin: InstallerPlugin): InstallerPlugin {
  return plugin;
}

export function defineRunnerPlugin(plugin: RunnerPlugin): RunnerPlugin {
  return plugin;
}

export function defineDeployerPlugin(plugin: DeployerPlugin): DeployerPlugin {
  return plugin;
}

/**
 * Empty DetectorResult, useful for early returns in detector plugins.
 */
export function emptyDetectorResult(): DetectorResult {
  return {
    languages: [],
    frameworks: [],
    packageManagers: [],
    manifests: [],
    files: [],
    env: [],
    entrypoints: [],
  };
}
