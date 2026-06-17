import { describe, it, expect } from 'vitest';
import { parseTomlFile, parseEnvFile, parseRequirementsFile } from '../src/utils/parsing.js';
import { which, versionOf, shellQuote, joinCommand } from '../src/utils/runtime.js';
import path from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('Lenient TOML parser (fallback)', () => {
  it('parses a simple pyproject.toml that strict parser handles', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pst-toml-'));
    const file = path.join(dir, 'pyproject.toml');
    writeFileSync(file, `
[project]
name = "test"
version = "1.0.0"
requires-python = ">=3.10"
dependencies = ["fastapi", "uvicorn"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
`);
    try {
      const result = await parseTomlFile(file);
      expect(result).not.toBeNull();
      const proj = (result as { project?: { name?: string } }).project;
      expect(proj?.name).toBe('test');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to lenient parser for mixed-type arrays', async () => {
    // This TOML has a mixed array (string + inline table) that strict parser
    // rejects but our lenient parser handles.
    const dir = mkdtempSync(path.join(tmpdir(), 'pst-toml-'));
    const file = path.join(dir, 'pyproject.toml');
    writeFileSync(file, `
[project]
name = "mixed"
authors = [
    "Plain String",
    { name = "John", email = "john@example.com" }
]
classifiers = [
    "Programming Language :: Python :: 3",
    "License :: OSI Approved :: MIT License",
]
`);
    try {
      const result = await parseTomlFile(file);
      expect(result).not.toBeNull();
      const proj = (result as { project?: { name?: string; authors?: unknown[]; classifiers?: unknown[] } }).project;
      expect(proj?.name).toBe('mixed');
      expect(proj?.authors).toHaveLength(2);
      expect(proj?.classifiers).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a nonexistent file', async () => {
    const result = await parseTomlFile('/nonexistent/path.toml');
    expect(result).toBeNull();
  });

  it('handles multi-line arrays', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pst-toml-'));
    const file = path.join(dir, 'pyproject.toml');
    writeFileSync(file, `
[project]
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "pytest>=8.0.0",
]
`);
    try {
      const result = await parseTomlFile(file);
      const proj = (result as { project?: { dependencies?: string[] } }).project;
      expect(proj?.dependencies).toHaveLength(3);
      expect(proj?.dependencies?.[0]).toContain('fastapi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseEnvFile', () => {
  it('parses key=value pairs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pst-env-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, `
# comment
PORT=3000
DATABASE_URL=postgres://localhost/db
EMPTY=
QUOTED="quoted value"
SINGLE='single value'
`);
    try {
      const result = await parseEnvFile(file);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(5);
      expect(result?.[0]).toEqual({ name: 'PORT', value: '3000' });
      expect(result?.[1]).toEqual({ name: 'DATABASE_URL', value: 'postgres://localhost/db' });
      expect(result?.[2]).toEqual({ name: 'EMPTY', value: undefined });
      expect(result?.[3]).toEqual({ name: 'QUOTED', value: 'quoted value' });
      expect(result?.[4]).toEqual({ name: 'SINGLE', value: 'single value' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for nonexistent file', async () => {
    const result = await parseEnvFile('/nonexistent/.env');
    expect(result).toBeNull();
  });
});

describe('parseRequirementsFile', () => {
  it('parses requirements.txt with comments and flags', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pst-req-'));
    const file = path.join(dir, 'requirements.txt');
    writeFileSync(file, `
# comment
fastapi==0.110.0
uvicorn[standard]>=0.27.0  # inline comment
-r other-requirements.txt
-e ./local-package

pytest>=8.0.0
`);
    try {
      const result = await parseRequirementsFile(file);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(3); // -r and -e lines are skipped
      expect(result?.[0]).toBe('fastapi==0.110.0');
      expect(result?.[1]).toBe('uvicorn[standard]>=0.27.0');
      expect(result?.[2]).toBe('pytest>=8.0.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for nonexistent file', async () => {
    const result = await parseRequirementsFile('/nonexistent/requirements.txt');
    expect(result).toBeNull();
  });
});

describe('Runtime utilities', () => {
  it('which() finds node on PATH', async () => {
    const result = await which('node');
    expect(result).not.toBeNull();
    expect(result).toContain('node');
  });

  it('which() returns null for nonexistent binary', async () => {
    const result = await which('nonexistent-binary-12345');
    expect(result).toBeNull();
  });

  it('versionOf() returns a version string for node', async () => {
    const result = await versionOf('node');
    expect(result).not.toBeNull();
    expect(result).toMatch(/\d+\.\d+/);
  });

  it('versionOf() returns null for nonexistent binary', async () => {
    const result = await versionOf('nonexistent-binary-12345');
    expect(result).toBeNull();
  });

  it('shellQuote() leaves safe strings unquoted', () => {
    expect(shellQuote('npm')).toBe('npm');
    expect(shellQuote('install')).toBe('install');
    expect(shellQuote('./path/to/file')).toBe('./path/to/file');
  });

  it('shellQuote() quotes strings with special characters', () => {
    expect(shellQuote('hello world')).toBe(`'hello world'`);
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
    expect(shellQuote('')).toBe(`''`);
  });

  it('joinCommand() joins command and args', () => {
    expect(joinCommand('npm', ['install', '--save'])).toBe('npm install --save');
    expect(joinCommand('echo', ['hello world'])).toBe(`echo 'hello world'`);
  });
});
