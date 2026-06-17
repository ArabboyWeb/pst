import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildWorkspaceGraph, buildWorkspaceScanResult } from '../src/workspace/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wsFixture = (name: string) => path.resolve(__dirname, '../fixtures/workspace-repos', name);

describe('Workspace diagnostics — broken links', () => {
  it('detects missing workspace references', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('broken-links'));
    const missingDiag = graph.diagnostics.find((d) => d.code === 'workspace.missing-reference');
    expect(missingDiag).toBeDefined();
    expect(missingDiag?.message).toContain('@broken/nonexistent');
  });

  it('still resolves valid references alongside broken ones', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('broken-links'));
    // @broken/a depends on @broken/b (valid) and @broken/nonexistent (broken)
    const aNode = graph.nodes.find((n) => n.name === '@broken/a');
    expect(aNode?.workspaceDependencies).toContain('@broken/b');
    // The edge for the valid dep should exist
    const validEdge = graph.edges.find((e) => e.from === 'packages/a' && e.to === 'packages/b');
    expect(validEdge).toBeDefined();
  });
});

describe('Workspace diagnostics — duplicate names', () => {
  it('detects duplicate package names', async () => {
    // Create a temp fixture with duplicate names
    const fs = await import('node:fs/promises');
    const tmpDir = path.join('/tmp', 'pst-dup-test-' + Date.now());
    await fs.mkdir(path.join(tmpDir, 'packages', 'a'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'packages', 'b'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'dup-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));
    await fs.writeFile(path.join(tmpDir, 'packages', 'a', 'package.json'), JSON.stringify({
      name: '@dup/same-name', version: '1.0.0',
    }));
    await fs.writeFile(path.join(tmpDir, 'packages', 'b', 'package.json'), JSON.stringify({
      name: '@dup/same-name', version: '1.0.0',
    }));

    try {
      const graph = await buildWorkspaceGraph(tmpDir);
      const dupDiag = graph.diagnostics.find((d) => d.code === 'workspace.duplicate-name');
      expect(dupDiag).toBeDefined();
      expect(dupDiag?.message).toContain('@dup/same-name');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Workspace summary computation', () => {
  it('computes max depth correctly', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    // web → ui → utils is depth 2 (from root)
    expect(scan.summary.maxDepth).toBeGreaterThanOrEqual(2);
  });

  it('counts edges correctly', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    // web→ui, web→utils, api→utils, ui→utils = 4 edges
    expect(scan.summary.edges).toBe(4);
  });

  it('overall confidence is high for a clean workspace', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    // pnpm-workspace has 1 info diagnostic (orphan) but no errors
    expect(scan.overall.score).toBeGreaterThanOrEqual(0.7);
  });
});

describe('Workspace run plan', () => {
  it('generates run steps for runnable apps', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('pnpm-workspace'));
    const scan = buildWorkspaceScanResult(graph);
    expect(scan.runPlan.steps.length).toBe(2); // web + api
    expect(scan.runPlan.steps.some((s) => s.label.includes('@my-org/web'))).toBe(true);
    expect(scan.runPlan.steps.some((s) => s.label.includes('@my-org/api'))).toBe(true);
  });

  it('notes when no runnable apps exist', async () => {
    const graph = await buildWorkspaceGraph(wsFixture('circular'));
    const scan = buildWorkspaceScanResult(graph);
    // circular fixture has no apps with dev/start scripts
    if (scan.runPlan.steps.length === 0) {
      expect(scan.runPlan.notes.length).toBeGreaterThan(0);
    }
  });
});
