import { spawn } from 'node:child_process';

/**
 * Detect whether a binary is available on the user's PATH.
 * Uses `which` on unix, `where` on windows. Returns the resolved path or null.
 */
export async function which(binary: string): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const child = spawn(cmd, [binary], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0) {
        const first = out.split(/\r?\n/)[0].trim();
        resolve(first || null);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Get the version string of a binary, e.g. `node --version`. Returns null if
 * the binary is missing or the version could not be extracted.
 */
export async function versionOf(
  binary: string,
  flag = '--version',
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(binary, [flag], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 && !out) return resolve(null);
      const match = out.match(/(\d+(?:\.\d+){0,3}[^\s]*)/);
      resolve(match ? match[1] : out.trim() || null);
    });
  });
}

/**
 * Quote a single shell argument safely for display.
 */
export function shellQuote(arg: string): string {
  if (arg === '') return `''`;
  if (/^[\w\-./@:=+,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Join a command + args into a single display string.
 */
export function joinCommand(cmd: string, args: string[]): string {
  return [cmd, ...args.map(shellQuote)].join(' ');
}
