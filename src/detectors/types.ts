import type {
  DetectedFile,
  DetectedFramework,
  DetectedLanguage,
  DetectedManifest,
  Diagnostic,
  EnvFile,
  PackageManager,
} from '../types/index.js';

/**
 * Context handed to every detector. The orchestrator builds this once.
 */
export interface DetectorContext {
  /** Absolute path to project root. */
  root: string;
  /** All files (relative paths) that fast-glob returned for the project. */
  allFiles: string[];
  /** Files that already produced a manifest in a prior detector. */
  claimedFiles: Set<string>;
  /** Diagnostics accumulator — detectors may push warnings/errors. */
  diagnostics: Diagnostic[];
  /** Logger shim (kept minimal — detectors should not log to stdout). */
  debug: (msg: string) => void;
}

/**
 * Intermediate result a detector contributes. The orchestrator merges all
 * detector outputs into the final `ProjectScanResult`.
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

export interface Detector {
  /** Stable identifier, e.g. "node". */
  id: string;
  /** Human-facing name, e.g. "Node.js". */
  name: string;
  /** Run detection. Always resolves; never throws. */
  detect(ctx: DetectorContext): Promise<DetectorResult>;
}

/**
 * Empty DetectorResult, useful for early returns.
 */
export function emptyResult(): DetectorResult {
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
