import path from 'node:path';
import { fileExists, toAbsolute } from '../utils/fs.js';
import { parseJson5File } from '../utils/parsing.js';
import { PackageJsonSchema, type PackageJson } from '../utils/validation.js';
import { conf } from '../utils/confidence.js';
import { NODE_ENTRYPOINT_CANDIDATES, NODE_MANIFEST } from '../utils/constants.js';
import type {
  DetectedFramework,
  DetectedManifest,
  PackageManager,
} from '../types/index.js';
import type { Detector, DetectorContext, DetectorResult } from './types.js';

const FRAMEWORK_SIGNATURES: Array<{
  id: DetectedFramework['id'];
  name: string;
  deps: string[];
  files: string[];
}> = [
  { id: 'next', name: 'Next.js', deps: ['next'], files: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  { id: 'remix', name: 'Remix', deps: ['@remix-run/node', '@remix-run/react'], files: ['remix.config.js'] },
  { id: 'nuxt', name: 'Nuxt', deps: ['nuxt'], files: ['nuxt.config.ts', 'nuxt.config.js'] },
  { id: 'sveltekit', name: 'SvelteKit', deps: ['@sveltejs/kit'], files: ['svelte.config.js'] },
  { id: 'nest', name: 'NestJS', deps: ['@nestjs/core'], files: ['nest-cli.json'] },
  { id: 'fastify', name: 'Fastify', deps: ['fastify'], files: [] },
  { id: 'express', name: 'Express', deps: ['express'], files: [] },
  { id: 'react', name: 'React', deps: ['react', 'react-dom'], files: [] },
  { id: 'vue', name: 'Vue', deps: ['vue'], files: [] },
];

export class NodeDetector implements Detector {
  id = 'node';
  name = 'Node.js';

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

    // Find all package.json files (excluding node_modules). The root one
    // wins for primary stack detection; subdirectory ones get lower
    // confidence and are recorded as secondary manifests only.
    const pkgPaths = ctx.allFiles
      .filter((f) => path.basename(f) === NODE_MANIFEST && !f.includes('node_modules'))
      .sort((a, b) => a.split('/').length - b.split('/').length); // shallowest first

    if (pkgPaths.length === 0) return out;

    const rootPkg = pkgPaths.find((p) => p === NODE_MANIFEST);
    const hasRootPkg = !!rootPkg;

    // Always parse the root package.json if present; otherwise parse the
    // shallowest subdirectory one.
    const primaryPkg = rootPkg ?? pkgPaths[0];
    const isRoot = primaryPkg === NODE_MANIFEST;

    const parsed = await parseJson5File<unknown>(toAbsolute(ctx.root, primaryPkg));
    const validation = PackageJsonSchema.safeParse(parsed);
    const pkg: PackageJson | null = validation.success ? validation.data : null;

    if (!pkg) {
      if (isRoot) {
        ctx.diagnostics.push({
          severity: 'warn',
          code: 'node.invalid-package-json',
          message: `package.json at ${primaryPkg} could not be parsed.`,
          nextStep: 'Validate the file with `npx jsonlint` and re-run.',
          path: primaryPkg,
        });
      }
      return out;
    }

    ctx.claimedFiles.add(primaryPkg);
    const manifest: DetectedManifest = {
      kind: 'package.json',
      path: primaryPkg,
      parsed: pkg,
      evidence: [primaryPkg],
    };
    out.manifests.push(manifest);
    out.files.push({
      path: primaryPkg,
      kind: 'manifest',
      note: isRoot ? 'Node.js manifest (root)' : `Node.js manifest (subdirectory: ${path.dirname(primaryPkg)})`,
    });

    // Lockfiles -> package manager inference (root only)
    const lockfiles: string[] = [];
    if (isRoot) {
      lockfiles.push(...(await detectNodePackageManager(ctx, out, primaryPkg)));
    }

    // Frameworks — only detect from the root package.json. Detecting from
    // subdirectory packages leads to false positives (e.g. next.js repo has
    // `express` in a docs example).
    if (isRoot) {
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      for (const sig of FRAMEWORK_SIGNATURES) {
        const matchedDep = sig.deps.find((d) => d in allDeps);
        const matchedFile = sig.files.length
          ? await firstExisting(ctx.root, sig.files)
          : undefined;
        if (matchedDep || matchedFile) {
          const evidence: string[] = [];
          if (matchedDep) {
            // Distinguish dependencies (strong signal) from devDependencies
            // (weaker — could be a build tool or test fixture).
            const isDevDep = !!pkg.devDependencies?.[matchedDep];
            evidence.push(`${isDevDep ? 'devDep' : 'dep'}:${matchedDep}`);
          }
          if (matchedFile) evidence.push(matchedFile);
          const score =
            matchedDep && matchedFile ? 0.95 :
            matchedDep && !matchedFile && sig.id === 'express' && allDeps['next'] ? 0.4 : // express as devDep alongside next — likely test server
            matchedDep && !matchedFile ? 0.75 :
            0.65;
          out.frameworks.push({
            id: sig.id,
            name: sig.name,
            evidence,
            confidence: conf(score, evidence.join(', ')),
          });
        }
      }
    }

    // Entrypoints — only from root package.json
    if (isRoot) {
      const entryFromManifest =
        pkg.module ?? pkg.main ?? (typeof pkg.bin === 'string' ? pkg.bin : undefined);
      if (entryFromManifest) {
        out.entrypoints.push(entryFromManifest);
      }
      // Only fall back to convention if no explicit entrypoint was declared.
      if (out.entrypoints.length === 0) {
        for (const candidate of NODE_ENTRYPOINT_CANDIDATES) {
          if (await fileExists(toAbsolute(ctx.root, candidate))) {
            out.entrypoints.push(candidate);
            break;
          }
        }
      }
    }

    // Language
    // Confidence calibration:
    //  - Root package.json with runtime dependencies: 0.97 (strong signal)
    //  - Root package.json with only devDependencies BUT a known framework
    //    in devDependencies (e.g. Next.js monorepo): 0.9 (still primary)
    //  - Root package.json with only devDependencies and no framework: 0.55
    //    (e.g. Django uses package.json for JS test tooling — Python is the
    //    real primary language)
    //  - Subdirectory package.json: 0.55
    const hasRuntimeDeps = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
    const allDepsForCheck = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const frameworkInDeps = FRAMEWORK_SIGNATURES.some((sig) =>
      sig.deps.some((d) => d in allDepsForCheck),
    );
    const isToolingOnly = isRoot && !hasRuntimeDeps && !frameworkInDeps;
    const langConf = isRoot
      ? (isToolingOnly ? 0.55 : 0.97)
      : 0.55;
    out.languages.push({
      id: 'node',
      name: 'Node.js',
      evidence: [primaryPkg, ...lockfiles],
      confidence: conf(
        langConf,
        isRoot
          ? (isToolingOnly
              ? `Found root ${primaryPkg} but it has only devDependencies and no framework (likely tooling-only)`
              : `Found root ${primaryPkg}`)
          : `Found subdirectory ${primaryPkg} (lower confidence)`,
      ),
      versionConstraint: pkg.engines?.node,
    });

    if (isToolingOnly) {
      ctx.diagnostics.push({
        severity: 'info',
        code: 'node.tooling-only',
        message: `package.json at root has no "dependencies" field and no framework in devDependencies — treating Node as a tooling stack, not the primary language.`,
        nextStep: 'If Node is actually the primary language, add runtime dependencies or a framework to package.json.',
        path: primaryPkg,
      });
    }

    if (!hasRootPkg && pkgPaths.length > 0) {
      ctx.diagnostics.push({
        severity: 'info',
        code: 'node.subdirectory-only',
        message: `No package.json at project root; fell back to ${primaryPkg}.`,
        nextStep: 'If this is a multi-package repo, consider adding a root package.json with workspaces.',
        path: primaryPkg,
      });
    }

    return out;
  }
}

async function detectNodePackageManager(
  ctx: DetectorContext,
  out: DetectorResult,
  pkgPath: string,
): Promise<string[]> {
  const pkgDir = path.dirname(pkgPath);
  const lockfiles: string[] = [];

  const candidates: Array<{ file: string; pm: PackageManager['id']; binary: string; name: string }> = [
    { file: 'pnpm-lock.yaml', pm: 'pnpm', binary: 'pnpm', name: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn', binary: 'yarn', name: 'Yarn' },
    { file: 'package-lock.json', pm: 'npm', binary: 'npm', name: 'npm' },
  ];

  for (const c of candidates) {
    const rel = pkgDir === '.' ? c.file : path.join(pkgDir, c.file);
    if (await fileExists(toAbsolute(ctx.root, rel))) {
      lockfiles.push(rel);
      ctx.claimedFiles.add(rel);
      out.files.push({
        path: rel,
        kind: 'lockfile',
        note: `${c.name} lockfile`,
      });
      out.packageManagers.push({
        id: c.pm,
        name: c.name,
        lockfiles: [rel],
        manifests: [pkgPath],
        binary: c.binary,
        confidence: conf(0.95, `Found ${rel}`),
      });
    }
  }

  if (lockfiles.length === 0) {
    // No lockfile — fall back to npm with reduced confidence. We don't warn
    // here because many real repos intentionally don't commit lockfiles;
    // the lower confidence score itself communicates the uncertainty.
    out.packageManagers.push({
      id: 'npm',
      name: 'npm',
      lockfiles: [],
      manifests: [pkgPath],
      binary: 'npm',
      confidence: conf(0.55, 'No lockfile found; assuming npm'),
    });
  }

  return lockfiles;
}

async function firstExisting(root: string, files: string[]): Promise<string | undefined> {
  for (const f of files) {
    if (await fileExists(toAbsolute(root, f))) return f;
  }
  return undefined;
}
