import { describe, it, expect } from 'vitest';
import { execute } from '../src/executor/index.js';

describe('Executor', () => {
  it('dry-run does not spawn and returns skipped=true', async () => {
    const result = await execute({
      command: 'echo hello',
      cwd: process.cwd(),
      dryRun: true,
      force: true,
      label: 'test',
    });
    expect(result.skipped).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('force flag executes without prompting and returns ok for true', async () => {
    const result = await execute({
      command: 'node -e "process.exit(0)"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'true test',
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('captures non-zero exit codes', async () => {
    const result = await execute({
      command: 'node -e "process.exit(7)"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'failing',
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });

  it('captures stdout', async () => {
    const result = await execute({
      command: 'node -e "process.stdout.write(\'hello-from-stdout\')"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'stdout test',
    });
    expect(result.stdout).toContain('hello-from-stdout');
  });
});
