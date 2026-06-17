import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { GoDetector } from '../src/detectors/go.js';
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

describe('GoDetector', () => {
  it('detects go.mod and infers Go modules PM', async () => {
    const ctx = await makeCtx(fixture('go-app'));
    const result = await new GoDetector().detect(ctx);

    expect(result.languages).toHaveLength(1);
    expect(result.languages[0].id).toBe('go');
    expect(result.languages[0].versionConstraint).toBe('1.22');

    const pm = result.packageManagers[0];
    expect(pm.id).toBe('go-mod');
    expect(pm.binary).toBe('go');
  });

  it('finds main.go as entrypoint', async () => {
    const ctx = await makeCtx(fixture('go-app'));
    const result = await new GoDetector().detect(ctx);
    expect(result.entrypoints).toContain('main.go');
  });

  it('returns empty result when go.mod is missing', async () => {
    const ctx = await makeCtx(fixture('empty-project'));
    const result = await new GoDetector().detect(ctx);
    expect(result.languages).toHaveLength(0);
  });
});
