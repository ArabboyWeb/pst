import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { scanProject } from '../src/core/index.js';
import { NodeDetector } from '../src/detectors/node.js';
import type { DetectorContext } from '../src/detectors/types.js';
import { globInProject } from '../src/utils/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

async function makeCtx(root: string): Promise<DetectorContext> {
  const allFiles = await globInProject(root, ['**/*']);
  return {
    root,
    allFiles,
    claimedFiles: new Set(),
    diagnostics: [],
    debug: () => {},
  };
}

describe('Node detector hardening', () => {
  it('downgrades confidence when package.json has only devDependencies and no framework', async () => {
    const ctx = await makeCtx(fixture('node-tooling-only'));
    const result = await new NodeDetector().detect(ctx);
    const node = result.languages[0];
    expect(node).toBeDefined();
    expect(node.id).toBe('node');
    expect(node.confidence.level).toBe('medium');
    expect(node.confidence.score).toBeLessThan(0.7);
    expect(ctx.diagnostics.some((d) => d.code === 'node.tooling-only')).toBe(true);
  });

  it('keeps high confidence when package.json has runtime dependencies', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new NodeDetector().detect(ctx);
    const node = result.languages[0];
    expect(node.confidence.level).toBe('high');
    expect(ctx.diagnostics.some((d) => d.code === 'node.tooling-only')).toBe(false);
  });

  it('keeps high confidence when package.json has only devDependencies but includes a framework (next.js monorepo pattern)', async () => {
    // The multi-stack fixture has next+react+react-dom in devDependencies
    const ctx = await makeCtx(fixture('multi-stack'));
    const result = await new NodeDetector().detect(ctx);
    const node = result.languages[0];
    expect(node.confidence.level).toBe('high');
    expect(node.confidence.score).toBeGreaterThanOrEqual(0.9);
    // Should NOT emit the tooling-only diagnostic
    expect(ctx.diagnostics.some((d) => d.code === 'node.tooling-only')).toBe(false);
  });

  it('does not crash on a malformed package.json', async () => {
    const ctx = await makeCtx(fixture('broken-node'));
    const result = await new NodeDetector().detect(ctx);
    expect(result.languages).toHaveLength(0);
    expect(ctx.diagnostics.some((d) => d.code === 'node.invalid-package-json')).toBe(true);
  });

  it('uses npm with reduced confidence when no lockfile is present', async () => {
    const ctx = await makeCtx(fixture('node-no-lockfile'));
    const result = await new NodeDetector().detect(ctx);
    const npm = result.packageManagers.find((p) => p.id === 'npm');
    expect(npm).toBeDefined();
    expect(npm.confidence.level).toBe('medium');
    expect(npm.confidence.score).toBeLessThan(0.7);
  });
});
