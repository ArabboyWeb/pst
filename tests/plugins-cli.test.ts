import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

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

describe('pst plugins commands', () => {
  it('pst plugins list shows all 6 built-in plugins', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'list', fixture('node-app')]);
    });
    expect(stderr).toContain('node');
    expect(stderr).toContain('python');
    expect(stderr).toContain('go');
    expect(stderr).toContain('docker');
    expect(stderr).toContain('generic');
    expect(stderr).toContain('builtin-planner');
  });

  it('pst plugins list --json produces valid JSON', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'list', fixture('node-app'), '--json']);
    });
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(6);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('kinds');
    expect(parsed[0]).toHaveProperty('source');
  });

  it('pst plugins inspect <id> shows details', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'inspect', 'node', fixture('node-app')]);
    });
    expect(stderr).toContain('Plugin: node');
    expect(stderr).toContain('Node.js');
    expect(stderr).toContain('detector');
    expect(stderr).toContain('OK');
  });

  it('pst plugins inspect <unknown-id> exits with code 1', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'inspect', 'nonexistent', fixture('node-app')]);
    });
    expect(stderr).toContain('not found');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('pst plugins validate reports all plugins valid', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'validate', fixture('node-app')]);
    });
    expect(stderr).toContain('valid');
    expect(stderr).toContain('Summary');
  });

  it('pst plugins list with --auto-discover does not crash', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync(['node', 'pst', 'plugins', 'list', fixture('node-app'), '--auto-discover']);
    });
    // Should still show built-in plugins even if no npm plugins found
    expect(stderr).toContain('builtin-planner');
  });
});
