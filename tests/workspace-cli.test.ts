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

describe('pst topology command', () => {
  it('produces text output for pnpm workspace', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('pnpm-workspace'), '--offline']);
    });
    expect(stdout).toContain('Workspace Topology Report');
    expect(stdout).toContain('pnpm-workspace');
    expect(stdout).toContain('@my-org/web');
    expect(stdout).toContain('Build order');
  });

  it('produces JSON output', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('pnpm-workspace'), '--offline', '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe('pnpm-workspace');
    expect(parsed.summary.totalPackages).toBe(5);
  });

  it('produces DOT output', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('pnpm-workspace'), '--offline', '--format', 'dot']);
    });
    expect(stdout).toContain('digraph workspace');
  });

  it('produces markdown output', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('pnpm-workspace'), '--offline', '--format', 'markdown']);
    });
    expect(stdout).toContain('# PST Workspace Topology');
  });

  it('handles non-workspace projects gracefully', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'topology', wsFixture('../node-app'), '--offline']);
    });
    expect(stdout).toContain('none');
  });
});

describe('pst graph command', () => {
  it('defaults to DOT format', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'graph', wsFixture('pnpm-workspace')]);
    });
    expect(stdout).toContain('digraph workspace');
    expect(stdout).toContain('->');
  });

  it('supports --format json', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'graph', wsFixture('pnpm-workspace'), '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.nodes).toBeDefined();
    expect(parsed.edges).toBeDefined();
  });
});

describe('pst workspace inspect command', () => {
  it('inspects a package by name', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'workspace', 'inspect', '@my-org/web', wsFixture('pnpm-workspace')]);
    });
    expect(stderr).toContain('Package: @my-org/web');
    expect(stderr).toContain('Node.js');
    expect(stderr).toContain('apps/web');
  });

  it('inspects a package by path id', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'workspace', 'inspect', 'apps/api', wsFixture('pnpm-workspace')]);
    });
    expect(stderr).toContain('@my-org/api');
  });

  it('produces JSON output', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'workspace', 'inspect', '@my-org/web', wsFixture('pnpm-workspace'), '--format', 'json']);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe('@my-org/web');
    expect(parsed.type).toBe('app');
  });

  it('errors on unknown package', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'workspace', 'inspect', 'nonexistent', wsFixture('pnpm-workspace')]);
    });
    expect(stderr).toContain('not found');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
