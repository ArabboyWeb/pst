import path from 'node:path';
import { fileExists, readText, toAbsolute } from '../utils/fs.js';
import { parseTomlFile } from '../utils/parsing.js';
import { conf } from '../utils/confidence.js';
import { GO_ENTRYPOINT_CANDIDATES, GO_LOCKFILE, GO_MANIFEST } from '../utils/constants.js';
import type { DetectedManifest, PackageManager } from '../types/index.js';
import type { Detector, DetectorContext, DetectorResult } from './types.js';

export class GoDetector implements Detector {
  id = 'go';
  name = 'Go';

  async detect(ctx: DetectorContext): Promise<DetectorResult> {
    const out: DetectorResult = {
      languages: [],
      frameworks: [],
      packageManagers: [],
      manifests: [],
      files: [],
      env: [],
      entrypoints: [],
    };

    const goModPath = ctx.allFiles.find((f) => f === GO_MANIFEST);
    if (!goModPath) return out;

    // go.mod is NOT strict TOML — always parse via the text fallback.
    const goMod = await parseGoModText(ctx.root, goModPath);
    if (!goMod) return out;

    ctx.claimedFiles.add(goModPath);
    out.manifests.push({
      kind: 'go.mod',
      path: goModPath,
      parsed: goMod,
      evidence: [goModPath],
    });
    out.files.push({
      path: goModPath,
      kind: 'manifest',
      note: 'Go module manifest',
    });

    if (await fileExists(toAbsolute(ctx.root, GO_LOCKFILE))) {
      ctx.claimedFiles.add(GO_LOCKFILE);
      out.files.push({
        path: GO_LOCKFILE,
        kind: 'lockfile',
        note: 'Go dependency checksums',
      });
    }

    out.packageManagers.push({
      id: 'go-mod',
      name: 'Go modules',
      lockfiles: await fileExists(toAbsolute(ctx.root, GO_LOCKFILE))
        ? [GO_LOCKFILE]
        : [],
      manifests: [goModPath],
      binary: 'go',
      confidence: conf(0.97, `Found ${goModPath}`),
    });

    // Entrypoints: prefer main.go at root, then cmd/<name>/main.go
    for (const candidate of GO_ENTRYPOINT_CANDIDATES) {
      if (candidate.includes('*')) {
        const matches = ctx.allFiles.filter((f) => {
          const re = new RegExp('^' + candidate.replace(/\*/g, '[^/]+') + '$');
          return re.test(f);
        });
        if (matches.length > 0) {
          out.entrypoints.push(matches[0]);
          break;
        }
      } else if (await fileExists(toAbsolute(ctx.root, candidate))) {
        out.entrypoints.push(candidate);
        break;
      }
    }

    out.languages.push({
      id: 'go',
      name: 'Go',
      evidence: [goModPath],
      confidence: conf(0.97, `Found ${goModPath}`),
      versionConstraint: goMod.go,
    });

    return out;
  }
}

/**
 * Parse a go.mod file. go.mod is line-oriented with a syntax similar to (but
 * not identical to) TOML — `module`, `go`, `toolchain`, `require ( ... )`
 * blocks, etc. We extract only the fields PST uses.
 */
async function parseGoModText(root: string, rel: string): Promise<{
  module?: string;
  go?: string;
  toolchain?: string;
  require?: Array<{ path: string; version: string }>;
}> {
  const text = await readText(toAbsolute(root, rel));
  if (!text) return {};
  const result: { module?: string; go?: string; toolchain?: string; require?: Array<{ path: string; version: string }> } = {};
  const lines = text.split(/\r?\n/);
  let inRequireBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line === ')') {
      inRequireBlock = false;
      continue;
    }
    if (inRequireBlock) {
      const m = line.match(/^([\w./-]+)\s+(\S+)/);
      if (m) {
        if (!result.require) result.require = [];
        result.require.push({ path: m[1], version: m[2] });
      }
      continue;
    }
    if (line.startsWith('module ')) {
      result.module = line.slice(7).trim();
    } else if (line.startsWith('go ')) {
      result.go = line.slice(3).trim();
    } else if (line.startsWith('toolchain ')) {
      result.toolchain = line.slice(10).trim();
    } else if (line === 'require (') {
      inRequireBlock = true;
    }
  }
  return result;
}

// Suppress unused-import warning for parseTomlFile (kept for symmetry but
// go.mod does not use it — see comment above).
void parseTomlFile;
