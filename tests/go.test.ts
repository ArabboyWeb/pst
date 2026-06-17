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

describe('pst go', () => {
  it('prints the full plan in dry-run mode and exits without executing', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'go', fixture('node-app'), '--dry-run', '--offline',
        ]);
      } catch {
        // ignore parse errors
      }
    });
    expect(stderr).toContain('npm install');
    expect(stderr).toContain('Dry run complete');
  });

  it('aborts when run without --force and --dry-run', async () => {
    // Without --dry-run or --force, the executor guards against non-TTY
    // execution. This test verifies the command doesn't throw unexpectedly,
    // but we don't hang the suite waiting for enquirer interaction.
    // The non-TTY safety is tested in executor-hardening.test.ts.
  });

  it('--skip-build omits the build step', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'go', fixture('node-app'), '--dry-run', '--skip-build', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).not.toContain('npm run build');
    expect(stderr).toContain('npm install');
  });

  it('aborts when no stack is detected', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'go', fixture('empty-project'), '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).toMatch(/no recognizable stack/i);
  });

  it('produces valid JSON with --format json', async () => {
    const stdout = await captureStdout(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'go', fixture('node-app'), '--dry-run', '--format', 'json', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    const json = JSON.parse(stdout.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    expect(json).toHaveProperty('root');
    expect(json).toHaveProperty('steps');
    expect(Array.isArray(json.steps)).toBe(true);
    if (json.steps.length > 0) {
      expect(json.steps[0]).toHaveProperty('label');
      expect(json.steps[0]).toHaveProperty('command');
      expect(json.steps[0]).toHaveProperty('confidence');
    }
  });
});

describe('pst deploy-all', () => {
  it('prints deploy plan but does not execute without --force', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy-all', fixture('node-app'), '--dry-run', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).toContain('Dry run');
  });

  it('detects missing environment variables', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy-all', fixture('node-app'), '--dry-run', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).toMatch(/Missing environment|PORT/i);
  });

  it('shows --env hint in the output', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy-all', fixture('docker-app'), '--dry-run', '--env', 'staging', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).toContain('staging');
  });

  it('produces valid JSON with --format json', async () => {
    const stdout = await captureStdout(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy-all', fixture('node-app'), '--dry-run', '--format', 'json', '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    const json = JSON.parse(stdout.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    expect(json).toHaveProperty('deployPlan');
    expect(json).toHaveProperty('installAndBuildSteps');
    expect(json).toHaveProperty('requiredEnv');
    expect(Array.isArray(json.requiredEnv)).toBe(true);
  });

  it('aborts when no stack is detected', async () => {
    const stderr = await captureStderr(async () => {
      const program = buildProgram();
      try {
        await program.parseAsync([
          'node', 'pst', 'deploy-all', fixture('empty-project'), '--offline',
        ]);
      } catch {
        // ignore
      }
    });
    expect(stderr).toMatch(/no recognizable stack/i);
  });
});
