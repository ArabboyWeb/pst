/**
 * Workspace intelligence types.
 *
 * A "workspace" is a monorepo: a repository containing multiple packages
 * managed together. PST models a workspace as a graph of nodes (packages)
 * connected by edges (dependencies).
 */

import type { DetectedLanguage, DetectedFramework, PackageManager, Diagnostic, Confidence } from '../types/index.js';

// ---------------------------------------------------------------------------
// Workspace kind
// ---------------------------------------------------------------------------

export type WorkspaceKind =
  | 'pnpm-workspace'
  | 'yarn-workspace'
  | 'turbo'
  | 'nx'
  | 'lerna'
  | 'rush'
  | 'none';

// ---------------------------------------------------------------------------
// Workspace node (a single package in the workspace)
// ---------------------------------------------------------------------------

export type WorkspaceNodeType =
  | 'app'        // an application (has entrypoint, runnable)
  | 'package'    // a library (consumed by other packages)
  | 'service'    // a deployable service
  | 'root';      // the workspace root itself

export interface WorkspaceNode {
  /** Globally unique id within the workspace, e.g. "apps/web" or "@my-org/ui". */
  id: string;
  /** Package name from package.json, or the directory name if unnamed. */
  name: string;
  /** Path relative to workspace root, e.g. "apps/web". */
  path: string;
  type: WorkspaceNodeType;
  /** Primary language detected in this package. */
  language?: DetectedLanguage;
  /** Frameworks detected in this package. */
  frameworks: DetectedFramework[];
  /** Package manager used by this package (usually inherits from root). */
  packageManager?: PackageManager;
  /** Whether this package has an entrypoint (runnable). */
  runnable: boolean;
  /** Dependencies on other workspace packages (by package name). */
  workspaceDependencies: string[];
  /** External dependencies count (for sizing). */
  externalDependencyCount: number;
  /** Scripts defined in this package's manifest. */
  scripts: string[];
}

// ---------------------------------------------------------------------------
// Workspace edge (a dependency relationship)
// ---------------------------------------------------------------------------

export type WorkspaceEdgeKind = 'dependency' | 'dev-dependency' | 'peer-dependency';

export interface WorkspaceEdge {
  /** Source node id (the dependent). */
  from: string;
  /** Target node id (the dependency). */
  to: string;
  kind: WorkspaceEdgeKind;
}

// ---------------------------------------------------------------------------
// Workspace graph
// ---------------------------------------------------------------------------

export interface WorkspaceGraph {
  /** Workspace root path (absolute). */
  root: string;
  /** What kind of workspace this is. */
  kind: WorkspaceKind;
  /** All nodes in the graph (including the root node). */
  nodes: WorkspaceNode[];
  /** All edges (dependency relationships). */
  edges: WorkspaceEdge[];
  /** Topological build order — node ids in dependency-first order. */
  buildOrder: string[];
  /** Diagnostics specific to workspace analysis. */
  diagnostics: WorkspaceDiagnostic[];
  /** When the scan ran. */
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// Workspace diagnostics
// ---------------------------------------------------------------------------

export type WorkspaceDiagnosticSeverity = 'error' | 'warn' | 'info';

export type WorkspaceDiagnosticCode =
  | 'workspace.circular-dependency'
  | 'workspace.orphan-package'
  | 'workspace.missing-reference'
  | 'workspace.broken-link'
  | 'workspace.duplicate-name'
  | 'workspace.missing-workspace-config';

export interface WorkspaceDiagnostic {
  severity: WorkspaceDiagnosticSeverity;
  code: WorkspaceDiagnosticCode;
  message: string;
  /** Related node id(s). */
  nodes?: string[];
  /** Concrete next step. */
  nextStep?: string;
}

// ---------------------------------------------------------------------------
// Workspace scan result (topology report)
// ---------------------------------------------------------------------------

export interface WorkspaceScanResult {
  root: string;
  kind: WorkspaceKind;
  scannedAt: string;
  /** Summary counts. */
  summary: {
    totalPackages: number;
    apps: number;
    packages: number;
    services: number;
    edges: number;
    maxDepth: number;
  };
  /** All nodes. */
  nodes: WorkspaceNode[];
  /** All edges. */
  edges: WorkspaceEdge[];
  /** Build order (topological sort). */
  buildOrder: string[];
  /** Diagnostics. */
  diagnostics: WorkspaceDiagnostic[];
  /** Workspace-level plans. */
  installPlan: WorkspacePlan;
  buildPlan: WorkspacePlan;
  testPlan: WorkspacePlan;
  runPlan: WorkspacePlan;
  /** Overall confidence in the workspace scan. */
  overall: Confidence;
}

export interface WorkspacePlan {
  /** Steps, each targeting one or more packages. */
  steps: WorkspacePlanStep[];
  /** Notes about the plan. */
  notes: string[];
}

export interface WorkspacePlanStep {
  /** Display label. */
  label: string;
  /** The command to run. */
  command: string;
  /** Which packages this step applies to (empty = all). */
  packages: string[];
  /** Rationale. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

export type TopologyFormat = 'text' | 'json' | 'markdown' | 'dot';
