import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildWorkspaceGraph, buildWorkspaceScanResult, renderTopology } from '../src/workspace/index.js';
import { detectWorkspace } from '../src/workspace/detector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wsFixture = (name: string) => path.resolve(__dirname, '../fixtures/workspace-repos', name);

describe('Workspace detector — additional edge cases', () => {
  it('returns empty patterns for non-workspace', async () => {
    const result = await detectWorkspace(wsFixture('../empty-project'));
    expect(result.kind).toBe('none');
    expect(result.packagePatterns).toEqual([]);
  });

  it('detects lerna config', async () => {
    // Create a temp lerna fixture
    const fs = await import('node:fs/promises');
    const tmpDir = path.join('/tmp', 'pst-lerna-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'lerna-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));
    await fs.writeFile(path.join(tmpDir, 'lerna.json'), JSON.stringify({
      packages: ['packages/*'],
      version: '8.0.0',
    }));

    try {
      const result = await detectWorkspace(tmpDir);
      expect(result.kind).toBe('lerna');
      expect(result.evidence).toContain('lerna.json');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Workspace graph — root node', () => {
  it('includes a root node with the root package name', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const root = graph.nodes.find((n) => n.type === 'root');
    expect(root).toBeDefined();
    expect(root?.id).toBe('.');
    expect(root?.name).toBe('pnpm-workspace-root');
    expect(root?.path).toBe('.');
  });
});

describe('Workspace topology — JSON serializable', () => {
  it('the full scan result is JSON-serializable', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    const json = JSON.stringify(scan);
    expect(json.length).toBeGreaterThan(100);
    const parsed = JSON.parse(json);
    expect(parsed.summary.totalPackages).toBe(5);
    expect(parsed.nodes.length).toBe(6); // root + 5 packages
  });
});

describe('Workspace topology — DOT format edge cases', () => {
  it('DOT output for empty workspace (no packages)', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('../empty-project'));
    const scan = buildWorkspaceScanResult(graph);
    const dot = renderTopology(scan, 'dot');
    // Should still produce valid DOT even with no nodes
    expect(dot).toContain('digraph workspace');
    expect(dot.trim().endsWith('}')).toBe(true);
  });
});
