import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildWorkspaceGraph, buildWorkspaceScanResult, renderTopology } from '../src/workspace/index.js';
import { detectWorkspace } from '../src/workspace/detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wsFixture = (name: string) => path.resolve(__dirname, '../fixtures/workspace-repos', name);

describe('Workspace detector', () => {
  it('detects pnpm workspace via pnpm-workspace.yaml', async () => {
    const result = await detectWorkspace(wsFixture('pnpm-workspace'));
    expect(result.kind).toBe('pnpm-workspace');
    expect(result.evidence).toContain('pnpm-workspace.yaml');
    expect(result.packagePatterns).toContain('apps/*');
    expect(result.packagePatterns).toContain('packages/*');
  });

  it('detects turbo via package.json workspaces + turbo.json', async () => {
    const result = await detectWorkspace(wsFixture('turbo-repo'));
    expect(result.kind).toBe('turbo');
    expect(result.evidence).toContain('turbo.json');
    expect(result.packagePatterns).toContain('apps/*');
  });

  it('detects nx via package.json workspaces + nx.json', async () => {
    const result = await detectWorkspace(wsFixture('nx-repo'));
    expect(result.kind).toBe('nx');
    expect(result.evidence).toContain('nx.json');
  });

  it('detects yarn workspace via package.json workspaces', async () => {
    const result = await detectWorkspace(wsFixture('polyglot-repo'));
    expect(result.kind).toBe('yarn-workspace');
    expect(result.packagePatterns).toContain('apps/*');
  });

  it('returns none for a non-workspace project', async () => {
    const result = await detectWorkspace(wsFixture('../node-app'));
    expect(result.kind).toBe('none');
  });

  it('parses pnpm-workspace.yaml package patterns', async () => {
    const result = await detectWorkspace(wsFixture('pnpm-workspace'));
    expect(result.packagePatterns).toEqual(expect.arrayContaining(['apps/*', 'packages/*']));
  });
});

describe('Workspace graph builder — pnpm workspace', () => {
  it('discovers all 5 packages', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const nonRoot = graph.nodes.filter((n) => n.type !== 'root');
    expect(nonRoot).toHaveLength(5);
  });

  it('classifies apps vs packages correctly', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const apps = graph.nodes.filter((n) => n.type === 'app');
    const packages = graph.nodes.filter((n) => n.type === 'package');
    expect(apps).toHaveLength(2); // web + api
    expect(packages).toHaveLength(3); // ui + utils + orphan
  });

  it('builds dependency edges from workspace: protocol', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    // web depends on ui and utils; api depends on utils; ui depends on utils
    expect(graph.edges.length).toBe(4);
  });

  it('computes topological build order', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    expect(graph.buildOrder.length).toBe(6); // root + 5 packages
    // utils (leaf) must come before ui, api, web
    const utilsIdx = graph.buildOrder.indexOf('packages/utils');
    const uiIdx = graph.buildOrder.indexOf('packages/ui');
    const webIdx = graph.buildOrder.indexOf('apps/web');
    expect(utilsIdx).toBeLessThan(uiIdx);
    expect(uiIdx).toBeLessThan(webIdx);
    expect(utilsIdx).toBeLessThan(webIdx);
  });

  it('detects orphan packages', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const orphanDiag = graph.diagnostics.find((d) => d.code === 'workspace.orphan-package');
    expect(orphanDiag).toBeDefined();
    expect(orphanDiag?.message).toContain('@my-org/orphan');
  });
});

describe('Workspace graph builder — circular dependencies', () => {
  it('detects circular dependencies', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('circular'));
    const cyclicDiag = graph.diagnostics.find((d) => d.code === 'workspace.circular-dependency');
    expect(cyclicDiag).toBeDefined();
    expect(cyclicDiag?.severity).toBe('error');
  });

  it('still produces a build order even with cycles (cyclic nodes appended)', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('circular'));
    expect(graph.buildOrder.length).toBeGreaterThan(0);
  });
});

describe('Workspace graph builder — turbo', () => {
  it('detects turbo workspace kind', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('turbo-repo'));
    expect(graph.kind).toBe('turbo');
  });

  it('discovers turbo packages', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('turbo-repo'));
    const nonRoot = graph.nodes.filter((n) => n.type !== 'root');
    expect(nonRoot.length).toBeGreaterThanOrEqual(2); // docs + tsconfig
  });
});

describe('Workspace graph builder — nx', () => {
  it('detects nx workspace kind', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('nx-repo'));
    expect(graph.kind).toBe('nx');
  });

  it('discovers nx packages', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('nx-repo'));
    const nonRoot = graph.nodes.filter((n) => n.type !== 'root');
    expect(nonRoot.length).toBeGreaterThanOrEqual(2); // client + shared
  });
});

describe('Workspace graph builder — non-workspace', () => {
  it('returns a none graph with a diagnostic for non-workspace projects', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('../node-app'));
    expect(graph.kind).toBe('none');
    expect(graph.nodes).toHaveLength(0);
    expect(graph.diagnostics.some((d) => d.code === 'workspace.missing-workspace-config')).toBe(true);
  });
});

describe('Workspace scan result (topology report)', () => {
  it('builds a complete scan result with summary and plans', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    expect(scan.kind).toBe('pnpm-workspace');
    expect(scan.summary.totalPackages).toBe(5);
    expect(scan.summary.apps).toBe(2);
    expect(scan.summary.packages).toBe(3);
    expect(scan.installPlan.steps.length).toBeGreaterThan(0);
    expect(scan.buildPlan.steps.length).toBeGreaterThan(0);
    expect(scan.testPlan.steps.length).toBeGreaterThan(0);
  });

  it('turbo workspace uses turbo commands', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('turbo-repo'));
    const scan = buildWorkspaceScanResult(graph);
    expect(scan.buildPlan.steps.some((s) => s.command.includes('turbo'))).toBe(true);
    expect(scan.testPlan.steps.some((s) => s.command.includes('turbo'))).toBe(true);
  });

  it('nx workspace uses nx commands', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('nx-repo'));
    const scan = buildWorkspaceScanResult(graph);
    expect(scan.buildPlan.steps.some((s) => s.command.includes('nx'))).toBe(true);
  });

  it('pnpm workspace uses pnpm install', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    expect(scan.installPlan.steps[0].command).toBe('pnpm install');
  });
});

describe('Topology output formats', () => {
  it('renders text output with key sections', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const text = renderTopology(scan, 'text');
    expect(text).toContain('Workspace Topology Report');
    expect(text).toContain('Summary');
    expect(text).toContain('Build order');
    expect(text).toContain('@my-org/web');
  });

  it('renders JSON output that is valid JSON', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const json = renderTopology(scan, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe('pnpm-workspace');
    expect(parsed.summary.totalPackages).toBe(5);
  });

  it('renders markdown output with tables', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const md = renderTopology(scan, 'markdown');
    expect(md).toContain('# PST Workspace Topology');
    expect(md).toContain('| Name | Path | Type |');
    expect(md).toContain('## Build order');
  });

  it('renders Graphviz DOT output', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const dot = renderTopology(scan, 'dot');
    expect(dot).toContain('digraph workspace');
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('"apps/web"');
    expect(dot).toContain('->');
    expect(dot.trim().endsWith('}')).toBe(true);
  });

  it('DOT output is valid Graphviz (can be parsed)', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const dot = renderTopology(scan, 'dot');
    // Basic structural checks
    expect(dot).toMatch(/^digraph workspace \{/);
    expect(dot.trim()).toMatch(/\}$/);
    // Every edge references declared nodes
    const nodeIds = scan.nodes.map((n) => n.id);
    const edgeMatches = dot.matchAll(/"([^"]+)" -> "([^"]+)"/g);
    for (const m of edgeMatches) {
      expect(nodeIds).toContain(m[1]);
      expect(nodeIds).toContain(m[2]);
    }
  });
});

describe('Workspace performance', () => {
  it('scans the pnpm workspace in under 2 seconds', async () => {
    const start = performance.now();
    await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(2000);
  });
});

describe('Polyglot workspace', () => {
  it('detects mixed-language packages in a polyglot repo', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('polyglot-repo'));
    expect(graph.kind).toBe('yarn-workspace');
    // Should find the Node packages (web, shared) — the Python package (api)
    // doesn't have a package.json so it won't be discovered as a workspace node,
    // but the workspace itself is still detected.
    const nodeNames = graph.nodes.map((n) => n.name);
    expect(nodeNames).toContain('@poly/web');
    expect(nodeNames).toContain('@poly/shared');
  });
});
