import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { GenericDetector } from '../src/detectors/generic.js';
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

describe('GenericDetector', () => {
  it('detects .env.example and parses variables', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new GenericDetector().detect(ctx);

    const env = result.env.find((e) => e.path === '.env.example');
    expect(env).toBeDefined();
    expect(env?.kind).toBe('example');
    const names = env?.variables.map((v) => v.name);
    expect(names).toContain('PORT');
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('JWT_SECRET');
  });

  it('discovers env vars from README code blocks', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new GenericDetector().detect(ctx);
    // The README has a ``` block listing PORT, DATABASE_URL, JWT_SECRET
    const readme = result.env.find((e) => e.path === 'README.md');
    expect(readme).toBeDefined();
    const names = readme?.variables.map((v) => v.name) ?? [];
    expect(names).toContain('PORT');
    expect(names).toContain('DATABASE_URL');
  });

  it('tags README as readme file', async () => {
    const ctx = await makeCtx(fixture('node-app'));
    const result = await new GenericDetector().detect(ctx);
    expect(result.files.some((f) => f.kind === 'readme' && f.path === 'README.md')).toBe(true);
  });
});
