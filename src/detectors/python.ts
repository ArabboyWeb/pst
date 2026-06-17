import path from 'node:path';
import { fileExists, toAbsolute } from '../utils/fs.js';
import { parseRequirementsFile, parseTomlFile } from '../utils/parsing.js';
import { PyprojectSchema, type Pyproject } from '../utils/validation.js';
import { conf } from '../utils/confidence.js';
import { PYTHON_ENTRYPOINT_CANDIDATES } from '../utils/constants.js';
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
}> = [
  { id: 'fastapi', name: 'FastAPI', deps: ['fastapi'] },
  { id: 'django', name: 'Django', deps: ['django'] },
  { id: 'flask', name: 'Flask', deps: ['flask'] },
];

export class PythonDetector implements Detector {
  id = 'python';
  name = 'Python';

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

    // Only root-level manifests drive primary stack detection.
    const pyprojectPath = ctx.allFiles.find((f) => f === 'pyproject.toml');
    const reqPath = ctx.allFiles.find((f) => f === 'requirements.txt');
    const setupPath = ctx.allFiles.find((f) => f === 'setup.py');
    const pipfilePath = ctx.allFiles.find((f) => f === 'Pipfile');

    const evidence: string[] = [];
    let versionConstraint: string | undefined;
    let hasPoetry = false;
    let hasUv = false;
    let hasBuildSystem = false;
    let deps: string[] = [];
    let consoleScript: string | undefined;

    // ---- pyproject.toml (preferred modern manifest) ----------------------
    if (pyprojectPath) {
      const parsed = await parseTomlFile<unknown>(toAbsolute(ctx.root, pyprojectPath));
      const validation = PyprojectSchema.safeParse(parsed);
      const pyproject: Pyproject | null = validation.success ? validation.data : null;
      if (pyproject) {
        ctx.claimedFiles.add(pyprojectPath);
        out.manifests.push({
          kind: 'pyproject.toml',
          path: pyprojectPath,
          parsed: pyproject,
          evidence: [pyprojectPath],
        });
        out.files.push({
          path: pyprojectPath,
          kind: 'manifest',
          note: 'Python project metadata (PEP 621 / Poetry / uv)',
        });
        evidence.push(pyprojectPath);
        versionConstraint = pyproject.project?.['requires-python'];

        if (pyproject.project?.dependencies) {
          deps.push(...pyproject.project.dependencies);
        }
        if (pyproject['build-system']) {
          hasBuildSystem = true;
        }
        if (pyproject.tool?.poetry) {
          hasPoetry = true;
          const d = pyproject.tool.poetry.dependencies ?? {};
          for (const [k, v] of Object.entries(d)) {
            if (k.toLowerCase() === 'python') continue;
            if (typeof v === 'string') deps.push(`${k}${v}`);
            else deps.push(k);
          }
        }
        if (pyproject.tool?.uv) {
          hasUv = true;
          if (pyproject.tool.uv['dev-dependencies']) {
            deps.push(...pyproject.tool.uv['dev-dependencies']);
          }
        }
        if (pyproject.project?.scripts) {
          // Store the script name only — NOT "console-script: foo:bar".
          // The planner can run this directly with `python -m <module>` or
          // treat it as a console entrypoint.
          const first = Object.values(pyproject.project.scripts)[0];
          if (first) consoleScript = first;
        }
      } else {
        ctx.diagnostics.push({
          severity: 'warn',
          code: 'python.invalid-pyproject',
          message: `pyproject.toml at ${pyprojectPath} could not be parsed even with the lenient fallback.`,
          nextStep: 'Check the file for TOML syntax errors with a TOML linter.',
          path: pyprojectPath,
        });
      }
    }

    // ---- requirements.txt -------------------------------------------------
    if (reqPath) {
      const reqs = await parseRequirementsFile(toAbsolute(ctx.root, reqPath));
      ctx.claimedFiles.add(reqPath);
      out.manifests.push({
        kind: 'requirements.txt',
        path: reqPath,
        parsed: reqs,
        evidence: [reqPath],
      });
      out.files.push({
        path: reqPath,
        kind: 'manifest',
        note: 'pip requirements file',
      });
      evidence.push(reqPath);
      if (reqs) deps.push(...reqs);
    }

    // ---- setup.py (legacy) ------------------------------------------------
    if (setupPath) {
      ctx.claimedFiles.add(setupPath);
      out.manifests.push({
        kind: 'setup.py',
        path: setupPath,
        evidence: [setupPath],
      });
      out.files.push({
        path: setupPath,
        kind: 'manifest',
        note: 'legacy setuptools setup.py',
      });
      evidence.push(setupPath);
    }

    // ---- Pipfile ----------------------------------------------------------
    if (pipfilePath) {
      ctx.claimedFiles.add(pipfilePath);
      out.manifests.push({
        kind: 'Pipfile',
        path: pipfilePath,
        evidence: [pipfilePath],
      });
      out.files.push({
        path: pipfilePath,
        kind: 'manifest',
        note: 'pipenv Pipfile',
      });
      evidence.push(pipfilePath);
    }

    if (evidence.length === 0) return out;

    // ---- Lockfiles -> package manager -------------------------------------
    const lockCandidates: Array<{ file: string; pm: PackageManager['id']; binary: string; name: string }> = [
      { file: 'uv.lock', pm: 'uv', binary: 'uv', name: 'uv' },
      { file: 'poetry.lock', pm: 'poetry', binary: 'poetry', name: 'Poetry' },
      { file: 'Pipfile.lock', pm: 'pipenv', binary: 'pipenv', name: 'Pipenv' },
    ];

    let primaryPm: PackageManager | null = null;
    for (const c of lockCandidates) {
      if (await fileExists(toAbsolute(ctx.root, c.file))) {
        ctx.claimedFiles.add(c.file);
        out.files.push({
          path: c.file,
          kind: 'lockfile',
          note: `${c.name} lockfile`,
        });
        const pm: PackageManager = {
          id: c.pm,
          name: c.name,
          lockfiles: [c.file],
          manifests: evidence,
          binary: c.binary,
          confidence: conf(0.95, `Found ${c.file}`),
        };
        out.packageManagers.push(pm);
        if (!primaryPm) primaryPm = pm;
      }
    }

    // If pyproject declares poetry/uv explicitly, prefer that even without a lock
    if (!primaryPm) {
      if (hasUv) {
        primaryPm = {
          id: 'uv',
          name: 'uv',
          lockfiles: [],
          manifests: evidence,
          binary: 'uv',
          confidence: conf(0.85, 'pyproject.toml [tool.uv] present'),
        };
        out.packageManagers.push(primaryPm);
      } else if (hasPoetry) {
        primaryPm = {
          id: 'poetry',
          name: 'Poetry',
          lockfiles: [],
          manifests: evidence,
          binary: 'poetry',
          confidence: conf(0.85, 'pyproject.toml [tool.poetry] present'),
        };
        out.packageManagers.push(primaryPm);
      } else if (pipfilePath) {
        primaryPm = {
          id: 'pipenv',
          name: 'Pipenv',
          lockfiles: [],
          manifests: evidence,
          binary: 'pipenv',
          confidence: conf(0.7, 'Pipfile present'),
        };
        out.packageManagers.push(primaryPm);
      } else if (reqPath) {
        primaryPm = {
          id: 'pip',
          name: 'pip',
          lockfiles: [],
          manifests: evidence,
          binary: 'pip',
          confidence: conf(0.8, 'requirements.txt present'),
        };
        out.packageManagers.push(primaryPm);
      } else if (setupPath) {
        // setup.py with no other PM hints — use pip install .
        primaryPm = {
          id: 'pip',
          name: 'pip',
          lockfiles: [],
          manifests: evidence,
          binary: 'pip',
          confidence: conf(0.7, 'setup.py present (legacy setuptools)'),
        };
        out.packageManagers.push(primaryPm);
      } else if (pyprojectPath && hasBuildSystem) {
        // PEP 517 build with no specific PM. Use pip with `.` (install the
        // project itself).
        primaryPm = {
          id: 'pip',
          name: 'pip',
          lockfiles: [],
          manifests: evidence,
          binary: 'pip',
          confidence: conf(0.75, 'pyproject.toml with [build-system] present'),
        };
        out.packageManagers.push(primaryPm);
      } else if (pyprojectPath) {
        primaryPm = {
          id: 'pip',
          name: 'pip',
          lockfiles: [],
          manifests: evidence,
          binary: 'pip',
          confidence: conf(0.6, 'pyproject.toml present, no PM hints'),
        };
        out.packageManagers.push(primaryPm);
      }
    }

    // ---- Frameworks -------------------------------------------------------
    // Detect from dependencies, but ALSO from project name / file conventions
    // (the Django repo itself doesn't list `django` as a dependency of
    // itself, but it IS Django).
    const pyproject = pyprojectPath
      ? out.manifests.find((m) => m.kind === 'pyproject.toml')?.parsed as
          | { project?: { name?: string } }
          | undefined
      : undefined;
    const projectName = pyproject?.project?.name?.toLowerCase() ?? '';

    for (const sig of FRAMEWORK_SIGNATURES) {
      const matchedDep = sig.deps.find((d) =>
        deps.some((dep) => dep.toLowerCase().startsWith(d.toLowerCase())),
      );
      // Self-detection: the project's name matches a framework name (e.g.
      // the Django repo itself).
      const selfMatched = projectName === sig.id || projectName === sig.name.toLowerCase();
      // File-based detection for Django (manage.py is canonical).
      const managePyPresent = sig.id === 'django' && await fileExists(toAbsolute(ctx.root, 'manage.py'));

      if (matchedDep || selfMatched || managePyPresent) {
        const evidence: string[] = [];
        if (matchedDep) evidence.push(`dep:${matchedDep}`);
        if (selfMatched) evidence.push(`project.name:${projectName}`);
        if (managePyPresent) evidence.push('manage.py');
        out.frameworks.push({
          id: sig.id,
          name: sig.name,
          evidence,
          confidence: conf(
            matchedDep ? 0.8 : selfMatched || managePyPresent ? 0.85 : 0.5,
            evidence.join(', '),
          ),
        });
      }
    }

    // ---- Entrypoints ------------------------------------------------------
    // Prefer console-script if declared; record the script *value* (e.g.
    // "myapp.cli:main"), not a synthetic "console-script:" prefix.
    if (consoleScript) {
      out.entrypoints.push(consoleScript);
    }
    for (const candidate of PYTHON_ENTRYPOINT_CANDIDATES) {
      if (await fileExists(toAbsolute(ctx.root, candidate))) {
        if (!out.entrypoints.includes(candidate)) {
          out.entrypoints.push(candidate);
        }
        break;
      }
    }

    // ---- Language ---------------------------------------------------------
    out.languages.push({
      id: 'python',
      name: 'Python',
      evidence,
      confidence: conf(0.95, `Found ${evidence.join(', ')}`),
      versionConstraint,
    });

    return out;
  }
}
