import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { fileURLToPath } from 'node:url';

export { fs, fsp, path, fg, fileURLToPath };

export const __filename = (meta: ImportMeta) => fileURLToPath(meta.url);
export const __dirname = (meta: ImportMeta) => path.dirname(__filename(meta));

/**
 * Does a file exist at the given path? Returns false for directories.
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function readJson<T = unknown>(p: string): Promise<T | null> {
  const text = await readText(p);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * List immediate children of a directory (names only, not paths).
 */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Walk a project tree and return paths (relative to root) matching the given
 * fast-glob patterns. Skips common noise directories.
 */
export async function globInProject(
  root: string,
  patterns: string[],
): Promise<string[]> {
  const result = await fg(patterns, {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/coverage/**',
      '**/.venv/**',
      '**/venv/**',
      '**/__pycache__/**',
      '**/.tox/**',
      '**/target/**',
    ],
    unique: true,
  });
  return result.sort();
}

/**
 * Resolve a project-relative path to absolute.
 */
export function toAbsolute(root: string, rel: string): string {
  return path.isAbsolute(rel) ? rel : path.resolve(root, rel);
}

/**
 * Inverse of toAbsolute.
 */
export function toRelative(root: string, abs: string): string {
  return path.relative(root, abs);
}
