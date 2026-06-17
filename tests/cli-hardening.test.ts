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
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

describe('CLI safety and consistency', () => {
  it('exposes all 10 commands with consistent descriptions', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    for (const expected of ['detect', 'inspect', 'plan', 'install', 'run', 'build', 'test', 'deploy', 'doctor', 'explain']) {
      expect(names).toContain(expected);
    }
  });

  it('every command that takes [path] also accepts --offline', () => {
    const program = buildProgram();
    for (const cmd of program.commands) {
      const opts = cmd.options.map((o) => o.long);
      if (cmd.args.length > 0) {
        expect(opts).toContain('--offline');
      }
    }
  });

  it('every execution command accepts --dry-run and --force', () => {
    const program = buildProgram();
    for (const name of ['install', 'run', 'build', 'test']) {
      const cmd = program.commands.find((c) => c.name() === name)!;
      const opts = cmd.options.map((o) => o.long);
      expect(opts).toContain('--dry-run');
      expect(opts).toContain('--force');
    }
  });

  it('deploy defaults to dry-run without --force', async () => {
    const program = buildProgram();
    // Use docker-app which has compose → deploy step exists
    const stderr = await captureStderr(async () => {
      await program.parseAsync([
        'node', 'pst', 'deploy', fixture('docker-app'), '--offline',
      ]);
    });
    // Should print the dry-run notice
    expect(stderr).toMatch(/dry-run/i);
  });

  it('deploy --force still prints the plan before executing', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      // We expect this to try to execute `vercel --prod` and fail (vercel not installed),
      // but the plan should be printed first.
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy', fixture('node-app'), '--offline', '--force',
        ]);
      } catch {
        // ignore — we just want to see the plan in stdout
      }
    });
    expect(stdout).toContain('Deploy Plan');
  });

  it('install with no plan exits with code 2 and helpful message', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync([
        'node', 'pst', 'install', fixture('empty-project'), '--offline',
      ]);
    });
    expect(stderr).toMatch(/no install plan/i);
    expect(stderr).toMatch(/pst explain/i);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0; // reset for subsequent tests
  });

  it('--format json produces valid JSON on stdout', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync([
        'node', 'pst', 'detect', fixture('node-app'), '--offline', '--format', 'json',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.languages[0].id).toBe('node');
  });

  it('--format markdown produces markdown on stdout', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync([
        'node', 'pst', 'detect', fixture('node-app'), '--offline', '--format', 'markdown',
      ]);
    });
    expect(stdout).toContain('# PST Report');
    expect(stdout).toContain('## Languages');
  });

  it('plan --only install hides other plans in JSON output', async () => {
    const program = buildProgram();
    const stdout = await captureStdout(async () => {
      await program.parseAsync([
        'node', 'pst', 'plan', fixture('node-app'), '--offline', '--format', 'json', '--only', 'install',
      ]);
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.installPlan.steps.length).toBeGreaterThan(0);
    expect(parsed.runPlan.steps).toHaveLength(0);
    expect(parsed.buildPlan.steps).toHaveLength(0);
  });

  it('doctor --offline skips binary checks but still shows diagnostics', async () => {
    const program = buildProgram();
    const stderr = await captureStderr(async () => {
      await program.parseAsync([
        'node', 'pst', 'doctor', fixture('node-app'), '--offline',
      ]);
    });
    expect(stderr).toMatch(/offline/i);
    // Should NOT contain version checks (those are skipped in offline mode)
    expect(stderr).not.toMatch(/v\d+\.\d+/);
  });

  it('handles a non-existent project path with a clear error', async () => {
    const program = buildProgram();
    let thrown: unknown = null;
    const stderr = await captureStderr(async () => {
      try {
        await program.parseAsync([
          'node', 'pst', 'detect', '/nonexistent/path/that/does/not/exist', '--offline',
        ]);
      } catch (err) {
        thrown = err;
      }
    });
    // The orchestrator throws synchronously when the root doesn't exist.
    // Either the throw propagates OR the top-level handler prints to stderr.
    const errMsg = thrown instanceof Error ? thrown.message : String(thrown ?? '');
    expect(errMsg + stderr).toMatch(/does not exist/i);
  });
});
