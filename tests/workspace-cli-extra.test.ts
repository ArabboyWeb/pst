import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wsFixture = (name: string) => path.resolve(__dirname, '../fixtures/workspace-repos', name);

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try { await fn(); } finally { process.stdout.write = original; }
  return captured;
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try { await fn(); } finally { process.stderr.write = original; }
  return captured;
}

describe('Workspace CLI — additional coverage', () => {
  it('topology on circular workspace exits with error code', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('circular'), '--offline']);
    });
    expect(stdout).toContain('circular-dependency');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('topology markdown output includes diagnostics section for circular', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('circular'), '--offline', '--format', 'markdown']);
    });
    expect(stdout).toContain('## Diagnostics');
    expect(stdout).toContain('circular-dependency');
  });

  it('graph command text format', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'graph', wsFixture('pnpm-workspace'), '--format', 'text']);
    });
    expect(stdout).toContain('Workspace Topology Report');
  });

  it('workspace inspect lists available packages on unknown id', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'workspace', 'inspect', 'nope', wsFixture('pnpm-workspace')]);
    });
    expect(stderr).toContain('not found');
    expect(stderr).toContain('@my-org/web');
    expect(stderr).toContain('@my-org/api');
  });

  it('topology on turbo repo produces turbo-specific build plan', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('turbo-repo'), '--offline', '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe('turbo');
    expect(parsed.buildPlan.steps.some((s: { command: string }) => s.command.includes('turbo'))).toBe(true);
  });

  it('topology on nx repo produces nx-specific build plan', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('nx-repo'), '--offline', '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe('nx');
    expect(parsed.buildPlan.steps.some((s: { command: string }) => s.command.includes('nx'))).toBe(true);
  });

  it('topology on polyglot repo detects yarn workspace', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('polyglot-repo'), '--offline', '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe('yarn-workspace');
  });
});
