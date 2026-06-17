/**
 * Core data model for PST.
 *
 * All types here are:
 *  - serializable (no functions, no class instances, no symbols)
 *  - explicit (no `any`, no implicit optionals)
 *  - easy to extend (discriminated unions where appropriate, optional fields
 *    for forward-compatibility)
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Confidence level reported to humans.
 * Numeric confidence is also kept internally (0.0..1.0).
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Confidence {
  /** Numeric score in [0,1]. */
  score: number;
  /** Human-facing bucketed level. */
  level: ConfidenceLevel;
  /** Why this score was assigned (one short sentence). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Languages, frameworks, package managers
// ---------------------------------------------------------------------------

export type LanguageId = 'node' | 'python' | 'go' | 'docker' | 'unknown';

export interface DetectedLanguage {
  id: LanguageId;
  name: string;
  /** Files that caused this language to be detected. */
  evidence: string[];
  confidence: Confidence;
  /** Detected version constraint if discoverable (e.g. ">=18", "3.11", "1.22"). */
  versionConstraint?: string;
}

export type FrameworkId =
  | 'next'
  | 'react'
  | 'vue'
  | 'nuxt'
  | 'express'
  | 'nest'
  | 'fastapi'
  | 'django'
  | 'flask'
  | 'fastify'
  | 'remix'
  | 'sveltekit'
  | 'unknown';

export interface DetectedFramework {
  id: FrameworkId;
  name: string;
  evidence: string[];
  confidence: Confidence;
}

export type PackageManagerId =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'pnpm-workspace'
  | 'yarn-workspace'
  | 'pip'
  | 'poetry'
  | 'uv'
  | 'pipenv'
  | 'go-mod'
  | 'docker'
  | 'compose'
  | 'unknown';

export interface PackageManager {
  id: PackageManagerId;
  name: string;
  /** Lockfile(s) that identified this PM, if any. */
  lockfiles: string[];
  /** Manifest(s) that identified this PM. */
  manifests: string[];
  /** Whether the PM binary is required to be installed locally. */
  binary: string;
  confidence: Confidence;
}

// ---------------------------------------------------------------------------
// Manifests and detected files
// ---------------------------------------------------------------------------

export type ManifestKind =
  | 'package.json'
  | 'package-lock.json'
  | 'pnpm-lock.yaml'
  | 'yarn.lock'
  | 'requirements.txt'
  | 'pyproject.toml'
  | 'poetry.lock'
  | 'uv.lock'
  | 'Pipfile'
  | 'Pipfile.lock'
  | 'setup.py'
  | 'go.mod'
  | 'go.sum'
  | 'Dockerfile'
  | 'docker-compose.yml'
  | 'docker-compose.yaml'
  | 'compose.yml'
  | 'compose.yaml';

export interface DetectedManifest {
  kind: ManifestKind;
  /** Path relative to the project root. */
  path: string;
  /** Raw parsed contents (any structured shape). */
  parsed?: unknown;
  /** Files that contributed to detection (typically just the path itself). */
  evidence: string[];
}

export interface DetectedFile {
  /** Path relative to the project root. */
  path: string;
  kind:
    | 'manifest'
    | 'lockfile'
    | 'env'
    | 'docker'
    | 'ci'
    | 'readme'
    | 'config'
    | 'entrypoint'
    | 'other';
  /** Why this file was flagged. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface EnvVar {
  name: string;
  /** Default value if declared inline; omitted if secret-only. */
  defaultValue?: string;
  required: boolean;
  /** Where this var was discovered. */
  source: string[];
  description?: string;
}

export interface EnvFile {
  path: string;
  kind: 'example' | 'actual' | 'template';
  /** Variables discovered inside (best-effort). */
  variables: EnvVar[];
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * A single concrete shell command plus the rationale for it.
 * Always render `command` exactly as written when executing.
 */
export interface PlannedCommand {
  /** Display label, e.g. "Install dependencies". */
  label: string;
  /** The exact command to run. */
  command: string;
  /** Why we picked this command. */
  rationale: string;
  /** Working directory relative to project root. Defaults to ".". */
  cwd?: string;
  /** Required environment variables for this command to succeed. */
  requiredEnv?: string[];
  /** Confidence in this specific command. */
  confidence: Confidence;
}

export interface InstallPlan {
  steps: PlannedCommand[];
  /** Package manager this plan assumes. */
  packageManager: PackageManagerId;
  notes: string[];
}

export interface RunPlan {
  steps: PlannedCommand[];
  /** Inferred entrypoint path (if any). */
  entrypoint?: string;
  notes: string[];
}

export interface BuildPlan {
  steps: PlannedCommand[];
  output?: string;
  notes: string[];
}

export interface TestPlan {
  steps: PlannedCommand[];
  notes: string[];
}

export interface DeployPlan {
  steps: PlannedCommand[];
  /** Where this project is intended to deploy (best guess). */
  targets: DeployTarget[];
  readiness: 'ready' | 'partial' | 'not-ready';
  notes: string[];
}

export type DeployTarget =
  | 'docker'
  | 'fly'
  | 'railway'
  | 'vercel'
  | 'netlify'
  | 'render'
  | 'heroku-like'
  | 'kubernetes'
  | 'generic-host'
  | 'unknown';

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /** Concrete next step the user can take. */
  nextStep?: string;
  /** Related file path (if any). */
  path?: string;
}

// ---------------------------------------------------------------------------
// Top-level scan result
// ---------------------------------------------------------------------------

export interface ProjectScanResult {
  /** Absolute path of the scanned project root. */
  root: string;
  /** Schema version for forward-compatibility. */
  schemaVersion: 1;
  scannedAt: string;
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: PackageManager[];
  manifests: DetectedManifest[];
  files: DetectedFile[];
  env: EnvFile[];
  /** Path(s) that look like the main entrypoint. */
  entrypoints: string[];
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
  diagnostics: Diagnostic[];
  /** Overall confidence in the entire scan. */
  overall: Confidence;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecutionRequest {
  /** The command to run. */
  command: string;
  cwd: string;
  /** Environment overrides. */
  env?: Record<string, string>;
  /** If true, do not actually spawn — just print and return success. */
  dryRun: boolean;
  /** Skip confirmation prompt. */
  force: boolean;
  /** Label shown to the user. */
  label?: string;
  /** Timeout in milliseconds (0 = no timeout). */
  timeoutMs?: number;
}

export interface ExecutionResult {
  command: string;
  dryRun: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True if exitCode === 0. */
  ok: boolean;
  /** If we aborted before spawning (e.g. user declined confirmation). */
  aborted?: boolean;
  /** If the command was skipped because of dry-run. */
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type ReportFormat = 'text' | 'json' | 'markdown';

export interface Report {
  format: ReportFormat;
  content: string;
}
