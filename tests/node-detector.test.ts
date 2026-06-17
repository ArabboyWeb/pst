import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
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

describe('NodeDetector', () => {
  it('detects package.json + npm lockfile', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new NodeDetector().detect(ctx);

    expect(result.languages).toHaveLength(1);
    expect(result.languages[0].id).toBe('node');
    expect(result.languages[0].confidence.level).toBe('high');

    expect(result.packageManagers.length).toBeGreaterThanOrEqual(1);
    const npm = result.packageManagers.find((p) => p.id === 'npm');
    expect(npm).toBeDefined();
    expect(npm?.lockfiles).toContain('package-lock.json');

    const pkg = result.manifests.find((m) => m.kind === 'package.json');
    expect(pkg).toBeDefined();
    expect(pkg?.path).toBe('package.json');

    expect(result.entrypoints).toContain('index.js');
  });

  it('detects Express framework from dependencies', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new NodeDetector().detect(ctx);

    const express = result.frameworks.find((f) => f.id === 'express');
    expect(express).toBeDefined();
    expect(express?.name).toBe('Express');
  });

  it('reads scripts from package.json', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new NodeDetector().detect(ctx);
    const pkg = result.manifests.find((m) => m.kind === 'package.json');
    const parsed = pkg?.parsed as { scripts: Record<string, string> };
    expect(parsed.scripts.dev).toBe('node index.js');
    expect(parsed.scripts.build).toBe('tsc');
  });

  it('records node version constraint from engines', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new NodeDetector().detect(ctx);
    expect(result.languages[0].versionConstraint).toBe('>=18');
  });

  it('warns when no lockfile is present', async () => {
    const ctx = await makeCtx(fixture('multi-stack'));
    const result = await new NodeDetector().detect(ctx);
    // multi-stack has pnpm-lock.yaml
    const pnpm = result.packageManagers.find((p) => p.id === 'pnpm');
    expect(pnpm).toBeDefined();
  });

  it('pushes a diagnostic when package.json is invalid', async () => {
    const ctx = await makeCtx(fixture('broken-node'));
    const result = await new NodeDetector().detect(ctx);
    // broken-node/package.json is missing the closing brace
    expect(result.languages).toHaveLength(0);
    expect(ctx.diagnostics.some((d) => d.code === 'node.invalid-package-json')).toBe(true);
  });
});
