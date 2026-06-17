import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildWorkspaceGraph, buildWorkspaceScanResult, renderTopology } from '../src/workspace/index.js';
import { buildProgram } from '../src/cli/cli.js';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Workspace performance — large workspace (50+ packages)', () => {
  it('handles 50 packages in under 3 seconds', async () => {
    // Generate a synthetic workspace with 50 packages
    const tmpDir = path.join('/tmp', 'pst-perf-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'perf-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));

    // Create 50 packages in a linear chain: pkg-0 ← pkg-1 ← ... ← pkg-49
    for (let i = 0; i < 50; i++) {
      const pkgDir = path.join(tmpDir, 'packages', `pkg-${i}`);
      await fs.mkdir(pkgDir, { recursive: true });
      const deps = i > 0 ? { [`@perf/pkg-${i - 1}`]: 'workspace:*' } : {};
      await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
        name: `@perf/pkg-${i}`,
        version: '1.0.0',
        scripts: { build: 'tsc', test: 'vitest run' },
        dependencies: deps,
      }));
    }

    try {
      const start = performance.now();
      const graph = await buildWorkspaceGraph(tmpDir);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(3000);
      expect(graph.nodes.filter((n) => n.type !== 'root')).toHaveLength(50);
      // Build order should be pkg-0 first, pkg-49 last
      expect(graph.buildOrder[1]).toBe('packages/pkg-0'); // after root
      expect(graph.buildOrder[graph.buildOrder.length - 1]).toBe('packages/pkg-49');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles a diamond dependency graph', async () => {
    // pkg-a ← pkg-b, pkg-a ← pkg-c, pkg-b ← pkg-d, pkg-c ← pkg-d
    const tmpDir = path.join('/tmp', 'pst-diamond-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'diamond-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));
    const pkgs = [
      { name: '@diamond/a', deps: {} },
      { name: '@diamond/b', deps: { '@diamond/a': 'workspace:*' } },
      { name: '@diamond/c', deps: { '@diamond/a': 'workspace:*' } },
      { name: '@diamond/d', deps: { '@diamond/b': 'workspace:*', '@diamond/c': 'workspace:*' } },
    ];
    for (const pkg of pkgs) {
      const dir = path.join(tmpDir, 'packages', pkg.name.split('/')[1]);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
        name: pkg.name, version: '1.0.0', dependencies: pkg.deps,
      }));
    }

    try {
      const graph = await buildWorkspaceGraph(tmpDir);
      // a must come before b and c; b and c must come before d
      const order = graph.buildOrder;
      const aIdx = order.indexOf('packages/a');
      const bIdx = order.indexOf('packages/b');
      const cIdx = order.indexOf('packages/c');
      const dIdx = order.indexOf('packages/d');
      expect(aIdx).toBeLessThan(bIdx);
      expect(aIdx).toBeLessThan(cIdx);
      expect(bIdx).toBeLessThan(dIdx);
      expect(cIdx).toBeLessThan(dIdx);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Workspace topology — edge cases', () => {
  it('handles a workspace with no packages (empty patterns)', async () => {
    const tmpDir = path.join('/tmp', 'pst-empty-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'empty-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));
    await fs.mkdir(path.join(tmpDir, 'packages'), { recursive: true });

    try {
      const graph = await buildWorkspaceGraph(tmpDir);
      // Only the root node; no packages
      expect(graph.nodes.filter((n) => n.type !== 'root')).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles a workspace where a package has no name', async () => {
    const tmpDir = path.join('/tmp', 'pst-noname-' + Date.now());
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'noname-root', version: '1.0.0', private: true, workspaces: ['packages/*'],
    }));
    const pkgDir = path.join(tmpDir, 'packages', 'unnamed');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({
      version: '1.0.0',
      scripts: { build: 'tsc' },
    }));

    try {
      const graph = await buildWorkspaceGraph(tmpDir);
      // The unnamed package should use its directory path as the name
      const unnamed = graph.nodes.find((n) => n.path === 'packages/unnamed');
      expect(unnamed).toBeDefined();
      expect(unnamed?.name).toBe('packages/unnamed');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Workspace CLI — all commands smoke test', () => {
  it('all workspace commands are registered', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('topology');
    expect(names).toContain('graph');
    expect(names).toContain('workspace');
    const workspaceCmd = program.commands.find((c) => c.name() === 'workspace')!;
    const subNames = workspaceCmd.commands.map((c) => c.name());
    expect(subNames).toContain('inspect');
  });
});
