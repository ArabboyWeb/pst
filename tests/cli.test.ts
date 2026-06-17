import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

describe('CLI parsing', () => {
  it('exposes all expected commands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('detect');
    expect(names).toContain('inspect');
    expect(names).toContain('plan');
    expect(names).toContain('install');
    expect(names).toContain('run');
    expect(names).toContain('build');
    expect(names).toContain('test');
    expect(names).toContain('deploy');
    expect(names).toContain('doctor');
    expect(names).toContain('explain');
  });

  it('accepts --format json on detect against a fixture', async () => {
    const program = buildProgram();
    // Capture stdout
    const original = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = (chunk: string | Uint8Array, encoding?: unknown) => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    };
    try {
      await program.parseAsync([
        'node', 'pst', 'detect', fixture('node-app'), '--format', 'json', '--offline',
      ]);
    } finally {
      process.stdout.write = original;
    }
    // Output should be valid JSON
    const parsed = JSON.parse(captured);
    expect(parsed.languages[0].id).toBe('node');
  });

  it('accepts --dry-run on install', async () => {
    const program = buildProgram();
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      await program.parseAsync([
        'node', 'pst', 'install', fixture('node-app'), '--dry-run', '--force', '--offline',
      ]);
    } finally {
      process.stderr.write = original;
    }
  });

  it('sets version', () => {
    const program = buildProgram();
    expect(program.version()).toBeTruthy();
  });

  it('plan command supports --only filter', async () => {
    const program = buildProgram();
    const original = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = (chunk: string | Uint8Array) => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    };
    try {
      await program.parseAsync([
        'node', 'pst', 'plan', fixture('node-app'), '--only', 'install', '--format', 'json', '--offline',
      ]);
    } finally {
      process.stdout.write = original;
    }
    const parsed = JSON.parse(captured);
    expect(parsed.installPlan.steps.length).toBeGreaterThan(0);
    expect(parsed.runPlan.steps).toHaveLength(0);
  });
});
