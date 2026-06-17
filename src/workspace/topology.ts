/**
 * Topology report generator + workspace planner.
 *
 * Converts a WorkspaceGraph into:
 *   - a topology report (WorkspaceScanResult)
 *   - workspace-level install/build/test/run plans
 *   - text / markdown / DOT output
 */

import type {
  WorkspaceGraph,
  WorkspaceScanResult,
  WorkspacePlan,
  WorkspaceNode,
  WorkspaceDiagnostic,
  TopologyFormat,
} from './types.js';
import { conf, combineConfidences } from '../utils/confidence.js';

/**
 * Build the full workspace scan result including plans.
 */
export function buildWorkspaceScanResult(graph: WorkspaceGraph): WorkspaceScanResult {
  const apps = graph.nodes.filter((n) => n.type === 'app');
  const packages = graph.nodes.filter((n) => n.type === 'package');
  const services = graph.nodes.filter((n) => n.type === 'service');

  const summary = {
    totalPackages: graph.nodes.filter((n) => n.type !== 'root').length,
    apps: apps.length,
    packages: packages.length,
    services: services.length,
    edges: graph.edges.length,
    maxDepth: computeMaxDepth(graph),
  };

  const installPlan = buildInstallPlan(graph);
  const buildPlan = buildBuildPlan(graph);
  const testPlan = buildTestPlan(graph);
  const runPlan = buildRunPlan(graph);

  // Overall confidence
  const errorCount = graph.diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = graph.diagnostics.filter((d) => d.severity === 'warn').length;
  const overall = errorCount > 0
    ? conf(0.3, `${errorCount} error(s) in workspace`)
    : warnCount > 0
      ? conf(0.7, `${warnCount} warning(s) in workspace`)
      : conf(0.95, 'Clean workspace');

  return {
    root: graph.root,
    kind: graph.kind,
    scannedAt: graph.scannedAt,
    summary,
    nodes: graph.nodes,
    edges: graph.edges,
    buildOrder: graph.buildOrder,
    diagnostics: graph.diagnostics,
    installPlan,
    buildPlan,
    testPlan,
    runPlan,
    overall,
  };
}

// ---------------------------------------------------------------------------
// Workspace plans
// ---------------------------------------------------------------------------

function buildInstallPlan(graph: WorkspaceGraph): WorkspacePlan {
  const steps = [];
  switch (graph.kind) {
    case 'pnpm-workspace':
      steps.push({
        label: 'Install all workspace dependencies (pnpm)',
        command: 'pnpm install',
        packages: [],
        rationale: 'pnpm workspace detected — single install at root installs all packages',
      });
      break;
    case 'yarn-workspace':
      steps.push({
        label: 'Install all workspace dependencies (yarn)',
        command: 'yarn install',
        packages: [],
        rationale: 'yarn workspace detected — single install at root',
      });
      break;
    case 'turbo':
      steps.push({
        label: 'Install all workspace dependencies',
        command: 'pnpm install', // turbo works with any PM; default to pnpm
        packages: [],
        rationale: 'Turborepo detected — install at root, turbo handles task orchestration',
      });
      break;
    case 'nx':
      steps.push({
        label: 'Install all workspace dependencies',
        command: 'npm install',
        packages: [],
        rationale: 'Nx workspace detected — install at root',
      });
      break;
    default:
      steps.push({
        label: 'Install all workspace dependencies',
        command: 'npm install',
        packages: [],
        rationale: 'Generic workspace — install at root',
      });
  }
  return { steps, notes: [] };
}

function buildBuildPlan(graph: WorkspaceGraph): WorkspacePlan {
  const steps = [];
  if (graph.kind === 'turbo') {
    steps.push({
      label: 'Build all packages (turbo)',
      command: 'turbo run build',
      packages: [],
      rationale: 'Turborepo orchestrates builds in topological order automatically',
    });
  } else if (graph.kind === 'nx') {
    steps.push({
      label: 'Build all projects (nx)',
      command: 'nx run-many --target=build --all',
      packages: [],
      rationale: 'Nx orchestrates builds in topological order automatically',
    });
  } else {
    // For pnpm/yarn workspaces without a task runner, build in topological order
    const buildable = graph.nodes.filter((n) => n.type !== 'root' && n.scripts.includes('build'));
    if (buildable.length > 0) {
      // Group by build order phases
      const phases = groupByBuildPhase(graph, buildable.map((n) => n.id));
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        const names = phase.map((id) => graph.nodes.find((n) => n.id === id)?.name).filter(Boolean);
        steps.push({
          label: `Build phase ${i + 1} (${phase.length} package${phase.length > 1 ? 's' : ''})`,
          command: phase.length === 1
            ? `npm run build --workspace ${names[0]}`
            : `npm run build --workspaces --if-present`,
          packages: phase,
          rationale: `Phase ${i + 1} of topological build order: ${names.join(', ')}`,
        });
      }
    } else {
      steps.push({
        label: 'Build (no build scripts found)',
        command: 'echo "No packages have a build script"',
        packages: [],
        rationale: 'No workspace packages declared a build script',
      });
    }
  }
  return { steps, notes: [] };
}

function buildTestPlan(graph: WorkspaceGraph): WorkspacePlan {
  const steps = [];
  if (graph.kind === 'turbo') {
    steps.push({
      label: 'Test all packages (turbo)',
      command: 'turbo run test',
      packages: [],
      rationale: 'Turborepo runs tests across all packages',
    });
  } else if (graph.kind === 'nx') {
    steps.push({
      label: 'Test all projects (nx)',
      command: 'nx run-many --target=test --all',
      packages: [],
      rationale: 'Nx runs tests across all projects',
    });
  } else {
    const testable = graph.nodes.filter((n) => n.type !== 'root' && n.scripts.includes('test'));
    if (testable.length > 0) {
      steps.push({
        label: `Test all packages (${testable.length} with test scripts)`,
        command: 'npm test --workspaces --if-present',
        packages: testable.map((n) => n.id),
        rationale: 'Run test script in every workspace package that has one',
      });
    } else {
      steps.push({
        label: 'Test (no test scripts found)',
        command: 'echo "No packages have a test script"',
        packages: [],
        rationale: 'No workspace packages declared a test script',
      });
    }
  }
  return { steps, notes: [] };
}

function buildRunPlan(graph: WorkspaceGraph): WorkspacePlan {
  const runnable = graph.nodes.filter((n) => n.runnable && n.type === 'app');
  if (runnable.length === 0) {
    return { steps: [], notes: ['No runnable apps found in this workspace.'] };
  }
  const steps = runnable.map((n) => ({
    label: `Run ${n.name}`,
    command: `npm run dev --workspace ${n.name}`,
    packages: [n.id],
    rationale: `App "${n.name}" has a dev or start script`,
  }));
  return { steps, notes: [] };
}

// ---------------------------------------------------------------------------
// Build phase computation (for non-turbo/nx workspaces)
// ---------------------------------------------------------------------------

function groupByBuildPhase(graph: WorkspaceGraph, buildableIds: string[]): string[][] {
  const phases: string[][] = [];
  const built = new Set<string>();
  built.add('.');

  const remaining = new Set(buildableIds);
  while (remaining.size > 0) {
    const phase: string[] = [];
    for (const id of remaining) {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) continue;
      // Can build this phase if all its workspace deps are already built
      const deps = graph.edges
        .filter((e) => e.from === id)
        .map((e) => e.to);
      if (deps.every((d) => built.has(d))) {
        phase.push(id);
      }
    }
    if (phase.length === 0) {
      // Circular dependency — push remaining as last phase
      phases.push(Array.from(remaining));
      break;
    }
    phases.push(phase);
    for (const p of phase) {
      built.add(p);
      remaining.delete(p);
    }
  }
  return phases;
}

function computeMaxDepth(graph: WorkspaceGraph): number {
  // Compute the longest dependency chain using memoized DFS.
  // Depth of a node = 1 + max(depth of its dependencies).
  // Root node (.) has depth 0. Leaf packages (no deps) have depth 1.
  const depthCache = new Map<string, number>();
  const visiting = new Set<string>(); // cycle protection

  function depth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (id === '.') return 0;
    if (visiting.has(id)) return 1; // cycle — treat as depth 1 to break recursion
    visiting.add(id);
    // Find all edges where this node is the dependent (from === id)
    const depEdges = graph.edges.filter((e) => e.from === id);
    if (depEdges.length === 0) {
      visiting.delete(id);
      depthCache.set(id, 1);
      return 1;
    }
    let maxDepDepth = 0;
    for (const edge of depEdges) {
      maxDepDepth = Math.max(maxDepDepth, depth(edge.to));
    }
    visiting.delete(id);
    const result = 1 + maxDepDepth;
    depthCache.set(id, result);
    return result;
  }

  let maxDepth = 0;
  for (const node of graph.nodes) {
    maxDepth = Math.max(maxDepth, depth(node.id));
  }
  return maxDepth;
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

export function renderTopology(scan: WorkspaceScanResult, format: TopologyFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(scan, null, 2);
    case 'markdown':
      return renderMarkdown(scan);
    case 'dot':
      return renderDot(scan);
    case 'text':
    default:
      return renderText(scan);
  }
}

function renderText(scan: WorkspaceScanResult): string {
  const lines: string[] = [];
  lines.push('PST — Workspace Topology Report');
  lines.push(`Root:      ${scan.root}`);
  lines.push(`Kind:      ${scan.kind}`);
  lines.push(`Scanned:   ${scan.scannedAt}`);
  lines.push(`Overall:   ${scan.overall.level} (${scan.overall.score})`);
  lines.push('');
  lines.push('Summary');
  lines.push(`  Total packages: ${scan.summary.totalPackages}`);
  lines.push(`  Apps:           ${scan.summary.apps}`);
  lines.push(`  Packages:       ${scan.summary.packages}`);
  lines.push(`  Services:       ${scan.summary.services}`);
  lines.push(`  Edges:          ${scan.summary.edges}`);
  lines.push(`  Max depth:      ${scan.summary.maxDepth}`);
  lines.push('');

  lines.push('Packages');
  for (const node of scan.nodes) {
    if (node.type === 'root') continue;
    const lang = node.language?.name ?? 'unknown';
    const typeIcon = node.type === 'app' ? '[app]' : node.type === 'service' ? '[svc]' : '[pkg]';
    lines.push(`  ${typeIcon} ${node.name} (${node.path}) — ${lang}, ${node.externalDependencyCount} ext deps`);
    if (node.workspaceDependencies.length > 0) {
      lines.push(`         depends on: ${node.workspaceDependencies.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('Build order (topological)');
  for (let i = 0; i < scan.buildOrder.length; i++) {
    const id = scan.buildOrder[i];
    const node = scan.nodes.find((n) => n.id === id);
    if (node && node.type !== 'root') {
      lines.push(`  ${i}. ${node.name} (${node.path})`);
    }
  }
  lines.push('');

  if (scan.diagnostics.length > 0) {
    lines.push('Diagnostics');
    for (const d of scan.diagnostics) {
      const icon = d.severity === 'error' ? '✗' : d.severity === 'warn' ? '!' : 'i';
      lines.push(`  ${icon} [${d.code}] ${d.message}`);
      if (d.nextStep) lines.push(`      fix: ${d.nextStep}`);
    }
    lines.push('');
  }

  lines.push('Install plan');
  for (const s of scan.installPlan.steps) lines.push(`  $ ${s.command}`);
  lines.push('');
  lines.push('Build plan');
  for (const s of scan.buildPlan.steps) lines.push(`  $ ${s.command}`);
  lines.push('');
  lines.push('Test plan');
  for (const s of scan.testPlan.steps) lines.push(`  $ ${s.command}`);
  lines.push('');
  if (scan.runPlan.steps.length > 0) {
    lines.push('Run plan');
    for (const s of scan.runPlan.steps) lines.push(`  $ ${s.command}`);
  } else {
    for (const n of scan.runPlan.notes) lines.push(`  note: ${n}`);
  }

  return lines.join('\n');
}

function renderMarkdown(scan: WorkspaceScanResult): string {
  const lines: string[] = [];
  lines.push(`# PST Workspace Topology — ${scan.root}`);
  lines.push('');
  lines.push(`- Kind: \`${scan.kind}\``);
  lines.push(`- Scanned: \`${scan.scannedAt}\``);
  lines.push(`- Overall confidence: **${scan.overall.level}** (${scan.overall.score})`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total packages | ${scan.summary.totalPackages} |`);
  lines.push(`| Apps | ${scan.summary.apps} |`);
  lines.push(`| Packages | ${scan.summary.packages} |`);
  lines.push(`| Services | ${scan.summary.services} |`);
  lines.push(`| Edges | ${scan.summary.edges} |`);
  lines.push(`| Max depth | ${scan.summary.maxDepth} |`);
  lines.push('');
  lines.push('## Packages');
  lines.push('| Name | Path | Type | Language | Ext deps | Workspace deps |');
  lines.push('|------|------|------|----------|----------|----------------|');
  for (const node of scan.nodes) {
    if (node.type === 'root') continue;
    const lang = node.language?.name ?? 'unknown';
    lines.push(`| ${node.name} | \`${node.path}\` | ${node.type} | ${lang} | ${node.externalDependencyCount} | ${node.workspaceDependencies.join(', ') || '-'} |`);
  }
  lines.push('');
  lines.push('## Build order');
  lines.push('```');
  for (let i = 0; i < scan.buildOrder.length; i++) {
    const id = scan.buildOrder[i];
    const node = scan.nodes.find((n) => n.id === id);
    if (node && node.type !== 'root') {
      lines.push(`${i}. ${node.name} (${node.path})`);
    }
  }
  lines.push('```');
  lines.push('');
  if (scan.diagnostics.length > 0) {
    lines.push('## Diagnostics');
    for (const d of scan.diagnostics) {
      const icon = d.severity === 'error' ? 'x' : d.severity === 'warn' ? '!' : 'i';
      lines.push(`- [${icon}] \`${d.code}\` ${d.message}`);
      if (d.nextStep) lines.push(`  - _fix:_ ${d.nextStep}`);
    }
    lines.push('');
  }
  lines.push('## Plans');
  lines.push('### Install');
  lines.push('```sh');
  for (const s of scan.installPlan.steps) lines.push(s.command);
  lines.push('```');
  lines.push('### Build');
  lines.push('```sh');
  for (const s of scan.buildPlan.steps) lines.push(s.command);
  lines.push('```');
  lines.push('### Test');
  lines.push('```sh');
  for (const s of scan.testPlan.steps) lines.push(s.command);
  lines.push('```');
  return lines.join('\n');
}

/**
 * Render as Graphviz DOT format for visualization.
 *
 * Each package is a node; each dependency is a directed edge.
 * Apps are rendered as boxes, packages as ellipses, services as diamonds.
 */
function renderDot(scan: WorkspaceScanResult): string {
  const lines: string[] = [];
  lines.push('digraph workspace {');
  lines.push('  rankdir=LR;');
  lines.push('  node [fontname="Helvetica"];');
  lines.push('  edge [fontname="Helvetica"];');
  lines.push('');

  // Nodes
  for (const node of scan.nodes) {
    const shape = node.type === 'app' ? 'box' : node.type === 'service' ? 'diamond' : node.type === 'root' ? 'folder' : 'ellipse';
    const label = node.name;
    const color = node.type === 'app' ? '#4CAF50' : node.type === 'service' ? '#FF9800' : node.type === 'root' ? '#9E9E9E' : '#2196F3';
    lines.push(`  "${node.id}" [label="${label}", shape=${shape}, color="${color}", style=filled, fillcolor="${color}33"];`);
  }
  lines.push('');

  // Edges
  for (const edge of scan.edges) {
    const style = edge.kind === 'dev-dependency' ? 'dashed' : 'solid';
    lines.push(`  "${edge.from}" -> "${edge.to}" [style=${style}];`);
  }
  lines.push('}');
  return lines.join('\n');
}
