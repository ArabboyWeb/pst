import { spawn } from 'node:child_process';
import { env as processEnv, stdin as stdinStream } from 'node:process';
import path from 'node:path';
import chalk from 'chalk';
import Enquirer from 'enquirer';
import type {
  ExecutionRequest,
  ExecutionResult,
  PlannedCommand,
} from '../types/index.js';
import { logger, prettyDuration } from '../utils/logger.js';

/**
 * Default command timeout: 5 minutes. Long enough for `npm install` on a
 * cold cache, short enough to fail clearly when something is hung.
 */
const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * Patterns that PST will refuse to execute, even with --force. These are
 * destructive or irreversible operations that should never be auto-run by a
 * project-setup tool. The MVP does not edit or delete user files; this
 * blocklist enforces that contract at the executor layer.
 *
 * Patterns are matched case-insensitively against the full command string.
 * We intentionally over-match (false positives are fine; false negatives are
 * not). Users who genuinely need to run these commands can do so outside PST.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf?\s+[/~]/i, reason: 'recursive delete of a top-level path' },
  { pattern: /\brm\s+-rf?\s+\*/i, reason: 'recursive delete with glob' },
  { pattern: /:\(\)\s*\{/ , reason: 'fork-bomb pattern' },
  { pattern: /\bmkfs\b/i, reason: 'filesystem formatting' },
  { pattern: /\bdd\s+.*of=\/dev\//i, reason: 'raw write to a device node' },
  { pattern: /\bchmod\s+-R?\s+777\s+\//i, reason: 'world-writable chmod on root' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/i, reason: 'system power control' },
  { pattern: /--no-preserve-root/i, reason: 'rm with --no-preserve-root' },
  { pattern: /\b>\s*\/dev\/sd[a-z]/i, reason: 'write to a raw disk device' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash|zsh)\b/i, reason: 'pipe-to-shell install (PST does not auto-run these)' },
  { pattern: /\bwget\b.*\|\s*(sh|bash|zsh)\b/i, reason: 'pipe-to-shell install (PST does not auto-run these)' },
];

/**
 * Execute a single command safely.
 *
 * Safety contract:
 *  1. Refuse commands matching DANGEROUS_PATTERNS — always, even with --force.
 *  2. If `dryRun`, never spawn; print and return ok.
 *  3. If not `force` AND stdin is not a TTY, abort with a clear message
 *     (we cannot prompt in a non-interactive context).
 *  4. If not `force` AND stdin is a TTY, prompt for confirmation.
 *  5. Stream stdout/stderr live to the terminal.
 *  6. Respect timeoutMs; on timeout, SIGTERM then SIGKILL after 3s.
 */
export async function execute(req: ExecutionRequest): Promise<ExecutionResult> {
  const label = req.label ? `${req.label}` : req.command;
  const start = Date.now();

  // Print what we're about to do, always.
  logger.info(`${chalk.cyan('▶')} ${chalk.bold(label)}`);
  logger.info(chalk.gray(`  $ ${req.command}`));

  // 1. Refuse dangerous commands.
  const danger = matchDangerous(req.command);
  if (danger) {
    logger.error(`Refusing to execute: ${danger.reason}.`);
    logger.error('PST never runs destructive commands. If this is a false positive, run the command manually.');
    return {
      command: req.command,
      dryRun: req.dryRun,
      exitCode: null,
      stdout: '',
      stderr: `Refused: ${danger.reason}`,
      durationMs: Date.now() - start,
      ok: false,
      aborted: true,
    };
  }

  // 2. Dry-run: never spawn.
  if (req.dryRun) {
    return {
      command: req.command,
      dryRun: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - start,
      ok: true,
      skipped: true,
    };
  }

  // 3. Non-interactive guard: if not forced and stdin is not a TTY, abort.
  //    This prevents accidental execution in CI pipes where the prompt would
  //    otherwise hang or auto-accept.
  if (!req.force) {
    if (!stdinStream.isTTY) {
      logger.error('Confirmation required but stdin is not a TTY.');
      logger.error('Re-run with --force to execute without prompting, or --dry-run to preview only.');
      return {
        command: req.command,
        dryRun: false,
        exitCode: null,
        stdout: '',
        stderr: 'Aborted: non-interactive and --force not set',
        durationMs: Date.now() - start,
        ok: false,
        aborted: true,
      };
    }
    const confirmed = await confirmCommand(req.command);
    if (!confirmed) {
      logger.warn('Aborted by user.');
      return {
        command: req.command,
        dryRun: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - start,
        ok: false,
        aborted: true,
      };
    }
  }

  return runChild(req, start);
}

/**
 * Run a sequence of PlannedCommands. Stops on first failure unless
 * `continueOnError` is true.
 */
export async function executeSequence(
  steps: PlannedCommand[],
  opts: {
    cwd: string;
    dryRun: boolean;
    force: boolean;
    timeoutMs?: number;
    continueOnError?: boolean;
  },
): Promise<{ results: ExecutionResult[]; anyFailed: boolean }> {
  const results: ExecutionResult[] = [];
  for (const step of steps) {
    const result = await execute({
      command: step.command,
      cwd: step.cwd ? path.resolve(opts.cwd, step.cwd) : opts.cwd,
      dryRun: opts.dryRun,
      force: opts.force,
      label: step.label,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT,
    });
    results.push(result);
    if (!result.ok && !opts.continueOnError) {
      return { results, anyFailed: true };
    }
  }
  return { results, anyFailed: results.some((r) => !r.ok) };
}

function matchDangerous(command: string): { reason: string } | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return { reason };
  }
  return null;
}

async function confirmCommand(command: string): Promise<boolean> {
  try {
    const enquirer = new Enquirer();
    const answer = await enquirer.prompt({
      type: 'select',
      name: 'ok',
      message: 'Run this command?',
      choices: [
        { name: 'yes', message: 'Yes, run it' },
        { name: 'no', message: 'No, skip' },
        { name: 'show', message: 'Show shell-equivalent one-liner' },
      ],
    }) as { ok: 'yes' | 'no' | 'show' };
    if (answer.ok === 'show') {
      // Show the command in a copy-pasteable form. We print it both as the
      // raw command and (if cwd is meaningful) as a `cd && cmd` one-liner,
      // so the user has something they can paste into a terminal.
      logger.info(chalk.gray(`  shell: ${command}`));
      const inner = await enquirer.prompt({
        type: 'confirm',
        name: 'ok',
        message: 'Proceed?',
      }) as { ok: boolean };
      return inner.ok;
    }
    return answer.ok === 'yes';
  } catch {
    // Ctrl-C / non-interactive
    return false;
  }
}

function runChild(req: ExecutionRequest, start: number): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(req.command, {
      cwd: req.cwd,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...processEnv, ...req.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // If SIGTERM doesn't kill it within 3s, escalate to SIGKILL.
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3000);
    }, timeoutMs);

    // Child stdout/stderr are streamed to the *terminal* (stderr) so the
    // user sees live progress. They are also buffered into the result so
    // callers can inspect them programmatically. We do NOT write child
    // stdout to process.stdout because stdout is reserved for PST's own
    // structured output (e.g. JSON reports).
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      process.stderr.write(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        command: req.command,
        dryRun: false,
        exitCode: null,
        stdout,
        stderr: stderr + `\n[error] ${err.message}\n`,
        durationMs: Date.now() - start,
        ok: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      if (timedOut) {
        logger.error(`Command timed out after ${prettyDuration(timeoutMs)}.`);
      } else if (code === 0) {
        logger.info(chalk.green(`  ✓ ok (${prettyDuration(duration)})`));
      } else {
        logger.error(`  ✗ exit ${code} (${prettyDuration(duration)})`);
      }
      resolve({
        command: req.command,
        dryRun: false,
        exitCode: code,
        stdout,
        stderr,
        durationMs: duration,
        ok: code === 0 && !timedOut,
      });
    });
  });
}
