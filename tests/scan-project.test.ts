import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { scanProject } from '../src/core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

describe('scanProject end-to-end', () => {
  it('scans a Node project and produces all plans', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });

    expect(scan.languages[0].id).toBe('node');
    expect(scan.packageManagers[0].id).toBe('npm');
    expect(scan.installPlan.steps[0].command).toBe('npm install');
    expect(scan.runPlan.steps[0].command).toBe('npm run dev');
    expect(scan.buildPlan.steps[0].command).toBe('npm run build');
    expect(scan.testPlan.steps[0].command).toBe('npm test');
  });

  it('scans a Python project and chooses pip', async () => {
    const scan = await scanProject({ root: fixture('python-app'), offline: true });
    expect(scan.languages[0].id).toBe('python');
    // pyproject + requirements.txt — pip wins as the explicit one
    expect(scan.packageManagers.some((p) => p.id === 'pip')).toBe(true);
    expect(scan.installPlan.steps[0].command).toContain('pip install');
  });

  it('scans a Go project', async () => {
    const scan = await scanProject({ root: fixture('go-app'), offline: true });
    expect(scan.languages[0].id).toBe('go');
    expect(scan.installPlan.steps[0].command).toBe('go mod download');
    expect(scan.runPlan.steps[0].command).toBe('go run main.go');
    expect(scan.buildPlan.steps[0].command).toContain('go build');
    expect(scan.testPlan.steps[0].command).toBe('go test ./...');
  });

  it('scans a Docker + compose project and prefers compose plans', async () => {
    const scan = await scanProject({ root: fixture('docker-app'), offline: true });
    expect(scan.languages.some((l) => l.id === 'docker')).toBe(true);
    expect(scan.installPlan.steps[0].command).toContain('docker compose');
    expect(scan.runPlan.steps[0].command).toContain('docker compose');
  });

  it('scans a multi-stack (Next.js + pnpm) project', async () => {
    const scan = await scanProject({ root: fixture('multi-stack'), offline: true });
    expect(scan.languages[0].id).toBe('node');
    expect(scan.packageManagers.some((p) => p.id === 'pnpm')).toBe(true);
    expect(scan.frameworks.some((f) => f.id === 'next')).toBe(true);
    expect(scan.runPlan.steps[0].command).toBe('pnpm run dev');
  });

  it('reports diagnostics for empty project', async () => {
    const scan = await scanProject({ root: fixture('empty-project'), offline: true });
    expect(scan.languages).toHaveLength(0);
    expect(scan.diagnostics.some((d) => d.code === 'plan.no-stack')).toBe(true);
    expect(scan.overall.score).toBe(0);
  });

  it('reports a warning for broken package.json', async () => {
    const scan = await scanProject({ root: fixture('broken-node'), offline: true });
    expect(scan.diagnostics.some((d) => d.code === 'node.invalid-package-json')).toBe(true);
  });

  it('exposes confidence in every detected item', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    for (const l of scan.languages) {
      expect(l.confidence.score).toBeGreaterThanOrEqual(0);
      expect(l.confidence.score).toBeLessThanOrEqual(1);
      expect(['high', 'medium', 'low']).toContain(l.confidence.level);
    }
    for (const pm of scan.packageManagers) {
      expect(['high', 'medium', 'low']).toContain(pm.confidence.level);
    }
  });

  it('schemaVersion is 1', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    expect(scan.schemaVersion).toBe(1);
  });

  it('is serializable to JSON', async () => {
    const scan = await scanProject({ root: fixture('node-app'), offline: true });
    const json = JSON.stringify(scan);
    expect(json.length).toBeGreaterThan(100);
    const parsed = JSON.parse(json);
    expect(parsed.languages[0].id).toBe('node');
  });
});
