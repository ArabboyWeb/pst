/**
 * pst-plugin-rust — detector module (reference implementation).
 *
 * This plugin adds Rust support to PST. It implements the `detector` kind:
 * reads Cargo.toml, identifies Rust as a language, Cargo as the package
 * manager, and src/main.rs as the entrypoint.
 *
 * NOTE: This file imports from `pst` (the published package) rather than
 * relative paths into PST's src/. This is the pattern real third-party
 * plugins will use. For local development/testing, we resolve `pst` to
 * the local package via the root tsconfig paths.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { conf, defineDetectorPlugin, PLUGIN_API_VERSION } from 'pst-cli/plugin-api';
import type { DetectorResult, PluginContext } from 'pst-cli/plugin-api';

async function fileExists(p: string): Promise<boolean> {
  try { const s = await fs.stat(p); return s.isFile(); } catch { return false; }
}

async function readText(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

/**
 * Minimal TOML parser for Cargo.toml. We only need [package] and [dependencies].
 * This avoids depending on a TOML library in the plugin.
 */
function parseCargoToml(text: string): Record<string, unknown> | null {
  try {
    const result: Record<string, unknown> = {};
    let currentSection = result;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const sectionMatch = line.match(/^\[([\w.-]+)\]$/);
      if (sectionMatch) {
        const sectionPath = sectionMatch[1].split('.');
        let cursor = result;
        for (const key of sectionPath) {
          if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
          cursor = cursor[key] as Record<string, unknown>;
        }
        currentSection = cursor;
        continue;
      }
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip inline comment
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim();
      // Parse value
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        currentSection[key] = value.slice(1, -1);
      } else if (value === 'true' || value === 'false') {
        currentSection[key] = value === 'true';
      } else if (/^-?\d+$/.test(value)) {
        currentSection[key] = Number(value);
      } else {
        currentSection[key] = value;
      }
    }
    return result;
  } catch {
    return null;
  }
}

export default defineDetectorPlugin({
  manifest: {
    id: 'rust',
    name: 'Rust',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
    owns: ['rust'],
    description: 'Detects Rust projects via Cargo.toml.',
    author: 'PST Contributors',
    homepage: 'https://github.com/pst-cli/pst',
  },

  async detect(ctx: PluginContext): Promise<DetectorResult> {
    const result: DetectorResult = {
      languages: [],
      frameworks: [],
      packageManagers: [],
      manifests: [],
      files: [],
      env: [],
      entrypoints: [],
    };

    const cargoTomlPath = ctx.allFiles.find((f) => f === 'Cargo.toml');
    if (!cargoTomlPath) return result;

    const absPath = path.resolve(ctx.root, cargoTomlPath);
    const text = await readText(absPath);
    if (!text) return result;
    const parsed = parseCargoToml(text);
    if (!parsed) {
      ctx.diagnostics.push({
        severity: 'warn',
        code: 'rust.invalid-cargo-toml',
        message: `Cargo.toml at ${cargoTomlPath} could not be parsed.`,
        nextStep: 'Validate the file with `cargo check`.',
        path: cargoTomlPath,
      });
      return result;
    }

    ctx.claimedFiles.add(cargoTomlPath);
    result.manifests.push({
      kind: 'Cargo.toml' as never,
      path: cargoTomlPath,
      parsed,
      evidence: [cargoTomlPath],
    });
    result.files.push({
      path: cargoTomlPath,
      kind: 'manifest',
      note: 'Rust manifest',
    });

    const hasLock = await fileExists(path.resolve(ctx.root, 'Cargo.lock'));
    if (hasLock) {
      ctx.claimedFiles.add('Cargo.lock');
      result.files.push({
        path: 'Cargo.lock',
        kind: 'lockfile',
        note: 'Cargo lockfile',
      });
    }

    const pkg = parsed.package as { name?: string; version?: string; edition?: string } | undefined;
    result.languages.push({
      id: 'rust' as never,
      name: 'Rust',
      evidence: [cargoTomlPath],
      confidence: conf(0.97, 'Found root Cargo.toml'),
      versionConstraint: pkg?.edition,
    });

    result.packageManagers.push({
      id: 'cargo' as never,
      name: 'Cargo',
      lockfiles: hasLock ? ['Cargo.lock'] : [],
      manifests: [cargoTomlPath],
      binary: 'cargo',
      confidence: conf(0.97, 'Found Cargo.toml'),
    });

    const deps = (parsed.dependencies ?? {}) as Record<string, unknown>;
    const knownFrameworks: Array<{ id: string; name: string; dep: string }> = [
      { id: 'actix-web', name: 'Actix Web', dep: 'actix-web' },
      { id: 'axum', name: 'Axum', dep: 'axum' },
      { id: 'rocket', name: 'Rocket', dep: 'rocket' },
      { id: 'warp', name: 'Warp', dep: 'warp' },
    ];
    for (const fw of knownFrameworks) {
      if (fw.dep in deps) {
        result.frameworks.push({
          id: fw.id as never,
          name: fw.name,
          evidence: [`dep:${fw.dep}`],
          confidence: conf(0.8, `Found dependency ${fw.dep}`),
        });
      }
    }

    if (await fileExists(path.resolve(ctx.root, 'src/main.rs'))) {
      result.entrypoints.push('src/main.rs');
    }

    return result;
  },
});
