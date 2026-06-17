import path from 'node:path';
import { readText, toAbsolute, fileExists } from '../utils/fs.js';
import { parseEnvFile } from '../utils/parsing.js';
import { conf } from '../utils/confidence.js';
import {
  CI_FILES,
  ENV_FILES,
  README_FILES,
} from '../utils/constants.js';
import type { EnvFile, EnvVar } from '../types/index.js';
import type { Detector, DetectorContext, DetectorResult } from './types.js';

/**
 * Detector for cross-cutting files that are not tied to one language:
 *  - .env / .env.example
 *  - CI files
 *  - README
 */
export class GenericDetector implements Detector {
  id = 'generic';
  name = 'Generic files';

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

    // ---- Env files --------------------------------------------------------
    for (const ef of ENV_FILES) {
      if (await fileExists(toAbsolute(ctx.root, ef))) {
        ctx.claimedFiles.add(ef);
        const vars = (await parseEnvFile(toAbsolute(ctx.root, ef))) ?? [];
        const kind: EnvFile['kind'] = ef.includes('example') || ef.includes('sample') || ef.includes('template')
          ? 'example'
          : ef === '.env'
            ? 'actual'
            : 'template';
        const envFile: EnvFile = {
          path: ef,
          kind,
          variables: vars.map((v) => ({
            name: v.name,
            defaultValue: v.value,
            required: kind === 'example',
            source: [ef],
          })),
        };
        out.env.push(envFile);
        out.files.push({
          path: ef,
          kind: 'env',
          note: `${kind} environment file`,
        });
      }
    }

    // ---- CI files ---------------------------------------------------------
    for (const ci of CI_FILES) {
      // .github/workflows is a directory
      if (ci === '.github/workflows') {
        const dir = toAbsolute(ctx.root, ci);
        if (await fileExists(dir)) {
          // Glob for yaml files inside
          const workflows = ctx.allFiles.filter(
            (f) => f.startsWith('.github/workflows/') &&
              (f.endsWith('.yml') || f.endsWith('.yaml')),
          );
          for (const w of workflows) {
            out.files.push({
              path: w,
              kind: 'ci',
              note: 'GitHub Actions workflow',
            });
          }
        }
        continue;
      }
      if (await fileExists(toAbsolute(ctx.root, ci))) {
        ctx.claimedFiles.add(ci);
        out.files.push({
          path: ci,
          kind: 'ci',
          note: 'CI configuration',
        });
      }
    }

    // ---- README -----------------------------------------------------------
    for (const r of README_FILES) {
      if (await fileExists(toAbsolute(ctx.root, r))) {
        ctx.claimedFiles.add(r);
        out.files.push({
          path: r,
          kind: 'readme',
          note: 'Project README',
        });
        // Best-effort env-var discovery from README (sections like "## Environment variables")
        const text = await readText(toAbsolute(ctx.root, r));
        if (text) {
          const discovered = scanReadmeForEnvVars(text, r);
          if (discovered.length > 0) {
            // Merge into any existing .env.example entry, else add a synthetic env entry
            const existing = out.env.find((e) => e.path === r);
            if (existing) {
              existing.variables.push(...discovered);
            } else {
              out.env.push({
                path: r,
                kind: 'template',
                variables: discovered,
              });
            }
          }
        }
        break;
      }
    }

    return out;
  }
}

/**
 * Scan README text for environment variable hints. Looks for fenced code
 * blocks containing `KEY=value` patterns.
 *
 * We intentionally do NOT scan for backtick-quoted uppercase words — that
 * produces too many false positives (HTTP methods like GET/PUT/POST, type
 * names like UUID/URL, acronyms like API/JSON, etc.). Real env vars almost
 * always appear with a value (`KEY=value`) or in a dedicated "Environment
 * variables" section.
 */
function scanReadmeForEnvVars(
  text: string,
  readmePath: string,
): EnvVar[] {
  const found = new Map<string, EnvVar>();

  // Match KEY=VALUE patterns inside fenced code blocks. Require the key to
  // be uppercase with at least 2 chars, and to contain at least one
  // underscore OR be a known env-var prefix (PORT, HOST, etc.). This
  // filters out false positives like `GET=...` (rare) while keeping
  // `DATABASE_URL=...`, `JWT_SECRET=`, etc.
  const fenceRe = /```[\s\S]*?```/g;
  for (const block of text.match(fenceRe) ?? []) {
    for (const line of block.split(/\r?\n/)) {
      const m = line.match(/^\s*(export\s+)?([A-Z][A-Z0-9_]{2,})=(.*)$/);
      if (m) {
        const name = m[2];
        // Require either an underscore (standard env-var convention) or a
        // known single-word env var. This filters `GET`, `PUT`, `UUID`,
        // `API`, etc.
        const hasUnderscore = name.includes('_');
        const isKnownSingle = ['PORT', 'HOST', 'NODE_ENV', 'DEBUG'].includes(name);
        if (!hasUnderscore && !isKnownSingle) continue;
        const value = m[3].trim();
        if (!found.has(name)) {
          found.set(name, {
            name,
            defaultValue: value || undefined,
            required: false,
            source: [readmePath],
          });
        }
      }
    }
  }

  return Array.from(found.values());
}
