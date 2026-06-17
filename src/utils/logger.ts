import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Minimal logger. Defaults to `info`. When the level is `silent`, nothing is
 * printed. Debug output goes to stderr so stdout stays clean for JSON output.
 */
class Logger {
  level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private rank(level: LogLevel): number {
    switch (level) {
      case 'debug':
        return 10;
      case 'info':
        return 20;
      case 'warn':
        return 30;
      case 'error':
        return 40;
      case 'silent':
        return 100;
    }
  }

  private shouldEmit(level: LogLevel): boolean {
    return this.rank(level) >= this.rank(this.level);
  }

  debug(msg: string, ...rest: unknown[]): void {
    if (!this.shouldEmit('debug')) return;
    process.stderr.write(chalk.gray(`[debug] ${msg}\n`));
    if (rest.length > 0) {
      for (const r of rest) {
        process.stderr.write(chalk.gray(`        ${safeStringify(r)}\n`));
      }
    }
  }

  info(msg: string, ...rest: unknown[]): void {
    if (!this.shouldEmit('info')) return;
    process.stderr.write(`${msg}\n`);
    if (rest.length > 0) {
      for (const r of rest) {
        process.stderr.write(`${safeStringify(r)}\n`);
      }
    }
  }

  warn(msg: string, ...rest: unknown[]): void {
    if (!this.shouldEmit('warn')) return;
    process.stderr.write(chalk.yellow(`[warn]  ${msg}\n`));
    if (rest.length > 0) {
      for (const r of rest) {
        process.stderr.write(chalk.yellow(`        ${safeStringify(r)}\n`));
      }
    }
  }

  error(msg: string, ...rest: unknown[]): void {
    if (!this.shouldEmit('error')) return;
    process.stderr.write(chalk.red(`[error] ${msg}\n`));
    if (rest.length > 0) {
      for (const r of rest) {
        process.stderr.write(chalk.red(`        ${safeStringify(r)}\n`));
      }
    }
  }
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export const logger = new Logger();

/**
 * Pretty-print a duration in milliseconds as e.g. "1.2s" or "340ms".
 */
export function prettyDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
