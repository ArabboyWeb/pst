import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DockerDetector } from '../src/detectors/docker.js';
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

describe('DockerDetector', () => {
  it('detects Dockerfile and compose file together', async () => {
    const ctx = await makeCtx(fixture('docker-app'));
    const result = await new DockerDetector().detect(ctx);

    expect(result.languages).toHaveLength(1);
    expect(result.languages[0].id).toBe('docker');

    const dockerfile = result.manifests.find((m) => m.kind === 'Dockerfile');
    expect(dockerfile).toBeDefined();
    expect(dockerfile?.path).toBe('Dockerfile');

    const compose = result.manifests.find((m) =>
      m.kind === 'docker-compose.yml' || m.kind === 'compose.yml');
    expect(compose).toBeDefined();

    expect(result.packageManagers[0].id).toBe('compose');
  });

  it('returns empty when no Docker artifacts', async () => {
    const ctx = await makeCtx(fixture('empty-project'));
    const result = await new DockerDetector().detect(ctx);
    expect(result.languages).toHaveLength(0);
  });
});
