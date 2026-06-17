import path from 'node:path';
import { fileExists, readText, toAbsolute } from '../utils/fs.js';
import { parseYamlFile } from '../utils/parsing.js';
import { conf } from '../utils/confidence.js';
import {
  COMPOSE_FILES,
  DOCKER_FILES,
} from '../utils/constants.js';
import type { DetectedManifest, PackageManager } from '../types/index.js';
import type { Detector, DetectorContext, DetectorResult } from './types.js';

export class DockerDetector implements Detector {
  id = 'docker';
  name = 'Docker';

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

    // All Dockerfiles (root and subdirectory). We record them all but only
    // the root one gets high-confidence treatment.
    const allDockerfiles = ctx.allFiles.filter((f) => {
      const base = path.basename(f);
      return DOCKER_FILES.some((d) => base === d) || base.toLowerCase() === 'dockerfile';
    });

    // Root-level Dockerfile (path === 'Dockerfile' or 'Dockerfile.<variant>')
    const rootDockerfile = allDockerfiles.find((f) => {
      const dir = path.dirname(f);
      return dir === '.' && (path.basename(f) === 'Dockerfile' || /^Dockerfile\.\w+$/.test(path.basename(f)));
    });

    // Compose files (always at root for MVP — subdirectory compose files are
    // rare and ambiguous).
    const composeFound: string[] = [];
    for (const cf of COMPOSE_FILES) {
      if (await fileExists(toAbsolute(ctx.root, cf))) {
        composeFound.push(cf);
        ctx.claimedFiles.add(cf);
        const parsed = await parseYamlFile(toAbsolute(ctx.root, cf));
        out.manifests.push({
          kind: cf.endsWith('.yaml') ? cf.replace('.yaml', '.yml') as 'docker-compose.yml' : cf as 'docker-compose.yml',
          path: cf,
          parsed: parsed ?? undefined,
          evidence: [cf],
        });
        out.files.push({
          path: cf,
          kind: 'docker',
          note: 'Docker Compose service definition',
        });
      }
    }

    // Record all Dockerfiles as files, but only the root one as a manifest.
    for (const df of allDockerfiles) {
      const isRoot = df === rootDockerfile;
      if (isRoot) {
        ctx.claimedFiles.add(df);
        out.manifests.push({
          kind: 'Dockerfile',
          path: df,
          evidence: [df],
          parsed: await readText(toAbsolute(ctx.root, df)).then((t) => t ?? undefined),
        });
      }
      out.files.push({
        path: df,
        kind: 'docker',
        note: isRoot ? 'Container image build definition (root)' : 'Container image build definition (subdirectory)',
      });
    }

    if (!rootDockerfile && composeFound.length === 0) {
      // Only subdirectory Dockerfiles (likely test fixtures) — do not claim
      // Docker as a primary stack. Emit a low-confidence note but no language
      // or PM.
      if (allDockerfiles.length > 0) {
        out.files = out.files; // already populated
        ctx.diagnostics.push({
          severity: 'info',
          code: 'docker.subdirectory-only',
          message: `Found ${allDockerfiles.length} Dockerfile(s) in subdirectories but none at the project root.`,
          nextStep: 'Subdirectory Dockerfiles are treated as test fixtures and do not trigger Docker planning. Add a root Dockerfile if this project should be built as a container.',
        });
      }
      return out;
    }

    // We have a root Dockerfile and/or a root compose file. The orchestrator
    // decides which plan wins; here we just emit the language + PM signals.
    out.languages.push({
      id: 'docker',
      name: 'Docker',
      evidence: [
        ...(rootDockerfile ? [rootDockerfile] : []),
        ...composeFound,
      ],
      confidence: conf(
        composeFound.length > 0 ? 0.97 : rootDockerfile ? 0.92 : 0.5,
        composeFound.length > 0
          ? `Found ${composeFound.join(', ')}`
          : rootDockerfile
            ? `Found root ${rootDockerfile}`
            : 'Weak Docker signal',
      ),
    });

    out.packageManagers.push({
      id: composeFound.length > 0 ? 'compose' : 'docker',
      name: composeFound.length > 0 ? 'Docker Compose' : 'Docker',
      lockfiles: [],
      manifests: [
        ...(rootDockerfile ? [rootDockerfile] : []),
        ...composeFound,
      ],
      binary: composeFound.length > 0 ? 'docker compose' : 'docker',
      confidence: conf(
        composeFound.length > 0 ? 0.97 : 0.92,
        composeFound.length > 0
          ? `Found ${composeFound.join(', ')}`
          : `Found root ${rootDockerfile}`,
      ),
    });

    return out;
  }
}
