import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { PythonDetector } from '../src/detectors/python.js';
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

describe('PythonDetector', () => {
  it('detects pyproject.toml + requirements.txt', async () => {
    const ctx = await makeCtx(fixture('python-app'));
    const result = await new PythonDetector().detect(ctx);

    expect(result.languages).toHaveLength(1);
    expect(result.languages[0].id).toBe('python');
    expect(result.languages[0].confidence.level).toBe('high');

    const pyproject = result.manifests.find((m) => m.kind === 'pyproject.toml');
    expect(pyproject).toBeDefined();
    const reqs = result.manifests.find((m) => m.kind === 'requirements.txt');
    expect(reqs).toBeDefined();
  });

  it('detects FastAPI from pyproject dependencies', async () => {
    const ctx = await makeCtx(fixture('python-app'));
    const result = await new PythonDetector().detect(ctx);
    const fastapi = result.frameworks.find((f) => f.id === 'fastapi');
    expect(fastapi).toBeDefined();
  });

  it('extracts requires-python constraint', async () => {
    const ctx = await makeCtx(fixture('python-app'));
    const result = await new PythonDetector().detect(ctx);
    expect(result.languages[0].versionConstraint).toBe('>=3.10');
  });

  it('registers a pip package manager when requirements.txt is present', async () => {
    const ctx = await makeCtx(fixture('python-app'));
    const result = await new PythonDetector().detect(ctx);
    const pip = result.packageManagers.find((p) => p.id === 'pip');
    expect(pip).toBeDefined();
  });

  it('extracts a console-script entrypoint from pyproject', async () => {
    const ctx = await makeCtx(fixture('python-app'));
    const result = await new PythonDetector().detect(ctx);
    // The detector stores the raw "module:func" form (e.g. "python_app.main:main"),
    // never a synthetic "console-script:" prefix.
    expect(result.entrypoints.some((e) => /^[A-Za-z_][\w.]*:[A-Za-z_]\w*$/.test(e))).toBe(true);
  });
});
