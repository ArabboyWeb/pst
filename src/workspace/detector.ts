/**
 * Workspace detector.
 *
 * Identifies what kind of monorepo this is by looking for canonical config
 * files at the project root. Returns 'none' if no workspace config is found.
 */

import path from 'node:path';
import { fileExists, readJson, toAbsolute } from '../utils/fs.js';
import type { WorkspaceKind } from './types.js';

export interface WorkspaceDetectionResult {
  kind: WorkspaceKind;
  /** Files that triggered the detection. */
  evidence: string[];
  /** Glob patterns for workspace packages (from pnpm-workspace.yaml or package.json workspaces). */
  packagePatterns: string[];
}

/**
 * Detect the workspace kind. Returns { kind: 'none' } if not a workspace.
 */
export async function detectWorkspace(root: string): Promise<WorkspaceDetectionResult> {
  // pnpm-workspace.yaml → pnpm workspace
  if (await fileExists(toAbsolute(root, 'pnpm-workspace.yaml'))) {
    const patterns = await parsePnpmWorkspacePatterns(root);
    return {
      kind: 'pnpm-workspace',
      evidence: ['pnpm-workspace.yaml'],
      packagePatterns: patterns,
    };
  }

  // package.json with "workspaces" field → yarn workspace (npm workspaces too)
  const pkgJson = await readJson<{ workspaces?: string[] | { packages?: string[] } }>(
    toAbsolute(root, 'package.json'),
  );
  if (pkgJson?.workspaces) {
    const patterns = Array.isArray(pkgJson.workspaces)
      ? pkgJson.workspaces
      : pkgJson.workspaces.packages ?? [];
    // Check for turbo.json — if present, this is a Turborepo (which uses
    // npm/yarn/pnpm workspaces under the hood, but adds its own task runner).
    if (await fileExists(toAbsolute(root, 'turbo.json'))) {
      return {
        kind: 'turbo',
        evidence: ['package.json (workspaces)', 'turbo.json'],
        packagePatterns: patterns,
      };
    }
    // Check for nx.json — Nx can use package.json workspaces or its own config.
    if (await fileExists(toAbsolute(root, 'nx.json'))) {
      return {
        kind: 'nx',
        evidence: ['package.json (workspaces)', 'nx.json'],
        packagePatterns: patterns,
      };
    }
    // Check for lerna.json
    if (await fileExists(toAbsolute(root, 'lerna.json'))) {
      return {
        kind: 'lerna',
        evidence: ['package.json (workspaces)', 'lerna.json'],
        packagePatterns: patterns,
      };
    }
    return {
      kind: 'yarn-workspace',
      evidence: ['package.json (workspaces)'],
      packagePatterns: patterns,
    };
  }

  // nx.json without package.json workspaces (Nx can use project.json files)
  if (await fileExists(toAbsolute(root, 'nx.json'))) {
    return {
      kind: 'nx',
      evidence: ['nx.json'],
      packagePatterns: ['**/*'], // Nx projects can be anywhere
    };
  }

  // rush.json
  if (await fileExists(toAbsolute(root, 'rush.json'))) {
    return {
      kind: 'rush',
      evidence: ['rush.json'],
      packagePatterns: [], // Rush uses projects.json, not globs
    };
  }

  return { kind: 'none', evidence: [], packagePatterns: [] };
}

/**
 * Parse pnpm-workspace.yaml to extract package glob patterns.
 * pnpm-workspace.yaml looks like:
 *   packages:
 *     - 'apps/*'
 *     - 'packages/*'
 *
 * We do a simple line-based parse (avoiding a YAML dependency for this one file).
 */
async function parsePnpmWorkspacePatterns(root: string): Promise<string[]> {
  const { readText } = await import('../utils/fs.js');
  const text = await readText(toAbsolute(root, 'pnpm-workspace.yaml'));
  if (!text) return [];
  const patterns: string[] = [];
  let inPackagesSection = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed === 'packages:') {
      inPackagesSection = true;
      continue;
    }
    // A new top-level key ends the packages section
    if (inPackagesSection && /^[a-zA-Z]/.test(line) && !line.startsWith('-') && !line.startsWith(' ')) {
      inPackagesSection = false;
      continue;
    }
    if (inPackagesSection) {
      const match = trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/);
      if (match) patterns.push(match[1]);
    }
  }
  return patterns;
}
