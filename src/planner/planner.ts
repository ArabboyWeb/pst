import path from 'node:path';
import type {
  BuildPlan,
  DeployPlan,
  DeployTarget,
  DetectedFramework,
  DetectedLanguage,
  DetectedManifest,
  Diagnostic,
  EnvFile,
  InstallPlan,
  PackageManager,
  PlannedCommand,
  RunPlan,
  TestPlan,
} from '../types/index.js';
import { conf } from '../utils/confidence.js';
import { fileExists, toAbsolute } from '../utils/fs.js';

/**
 * Input bundle for the planner — produced by merging all detector results.
 */
export interface PlannerInput {
  root: string;
  languages: DetectedLanguage[];
  frameworks: DetectedFramework[];
  packageManagers: PackageManager[];
  manifests: DetectedManifest[];
  env: EnvFile[];
  entrypoints: string[];
  hasDocker: boolean;
  hasCompose: boolean;
  dockerfilePaths: string[];
  composePaths: string[];
}

/**
 * Output bundle — the planner produces all five plans at once because they
 * share intermediate state (primary PM, primary language, framework).
 */
export interface PlannerOutput {
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
  diagnostics: Diagnostic[];
}

export async function buildPlans(input: PlannerInput): Promise<PlannerOutput> {
  const diagnostics: Diagnostic[] = [];

  const primaryLang = input.languages[0];
  const primaryPm = input.packageManagers[0];
  const primaryFramework = input.frameworks[0];

  // Collect env var names that are required (from .env.example primarily).
  const requiredEnv = new Set<string>();
  for (const e of input.env) {
    if (e.kind === 'example') {
      for (const v of e.variables) {
        if (v.required) requiredEnv.add(v.name);
      }
    }
  }

  let installPlan: InstallPlan;
  let runPlan: RunPlan;
  let buildPlan: BuildPlan;
  let testPlan: TestPlan;
  let deployPlan: DeployPlan;

  // PLANNING PRECEDENCE (corrected):
  //
  // 1. If a primary *programming* language is detected (Node/Python/Go) with
  //    its own manifest, use that language's install/run/build/test plans.
  //    Docker, if present at the root, becomes a *deploy target* only.
  //
  // 2. If no primary language is detected but Docker/Compose exists at root,
  //    use Docker-driven plans.
  //
  // 3. Compose-only repositories (no language manifest at all) get full
  //    compose-driven install/run/build.
  //
  // The previous logic wrongly let Dockerfile presence hijack a Node project
  // (e.g. httpie, docker/compose) and produced empty install plans.
  const langIsPrimary =
    primaryLang &&
    primaryLang.id !== 'docker' &&
    primaryLang.confidence.level !== 'low';

  const composeOnly =
    input.hasCompose &&
    !langIsPrimary;

  const dockerOnly =
    input.hasDocker &&
    !input.hasCompose &&
    !langIsPrimary;

  if (composeOnly) {
    ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
      await composePlans(input, primaryPm, requiredEnv));
  } else if (dockerOnly) {
    ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
      await dockerfilePlans(input, requiredEnv));
  } else if (primaryLang?.id === 'node' && primaryPm) {
    ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
      await nodePlans(input, primaryPm, primaryFramework, requiredEnv));
  } else if (primaryLang?.id === 'python' && primaryPm) {
    ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
      await pythonPlans(input, primaryPm, primaryFramework, requiredEnv));
  } else if (primaryLang?.id === 'go' && primaryPm) {
    ({ installPlan, runPlan, buildPlan, testPlan, deployPlan } =
      await goPlans(input, primaryPm, requiredEnv));
  } else {
    diagnostics.push({
      severity: 'error',
      code: 'plan.no-stack',
      message: 'PST could not identify a supported stack to plan against.',
      nextStep:
        'Add a package.json, pyproject.toml/requirements.txt, go.mod, or root Dockerfile at the project root and re-run.',
    });
    installPlan = emptyInstall('unknown');
    runPlan = { steps: [], notes: ['No run plan: unsupported stack.'] };
    buildPlan = { steps: [], notes: ['No build plan: unsupported stack.'] };
    testPlan = { steps: [], notes: ['No test plan: unsupported stack.'] };
    deployPlan = {
      steps: [],
      targets: ['unknown'],
      readiness: 'not-ready',
      notes: ['No deploy plan: unsupported stack.'],
    };
  }

  // If we planned via the language path AND Docker is present at the root,
  // attach a Docker-based deploy step.
  if (langIsPrimary && input.hasDocker) {
    deployPlan = attachDockerDeploy(input, deployPlan);
  } else if (langIsPrimary && input.hasCompose) {
    deployPlan = attachComposeDeploy(input, deployPlan);
  }

  return {
    installPlan,
    runPlan,
    buildPlan,
    testPlan,
    deployPlan,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

async function nodePlans(
  input: PlannerInput,
  pm: PackageManager,
  framework: DetectedFramework | undefined,
  requiredEnv: Set<string>,
): Promise<{
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
}> {
  const installStep: PlannedCommand = {
    label: 'Install dependencies',
    command: `${pm.binary} install`,
    rationale: pm.lockfiles.length > 0
      ? `Found ${pm.name} lockfile (${pm.lockfiles[0]}).`
      : `No lockfile found; using ${pm.name} install (will create a lockfile).`,
    confidence: conf(
      pm.lockfiles.length > 0 ? 0.92 : 0.55,
      pm.lockfiles.length > 0
        ? `${pm.name} lockfile present`
        : 'No lockfile; assuming npm install',
    ),
  };

  // Read scripts from package.json
  const pkgManifest = input.manifests.find((m) => m.kind === 'package.json');
  const scripts: Record<string, string> =
    (pkgManifest?.parsed as { scripts?: Record<string, string> })?.scripts ?? {};
  const pkg = pkgManifest?.parsed as { main?: string; module?: string } | undefined;

  const runSteps: PlannedCommand[] = [];
  const buildSteps: PlannedCommand[] = [];
  const testSteps: PlannedCommand[] = [];

  // Run / start
  if (scripts['dev']) {
    runSteps.push({
      label: 'Run dev server',
      command: `${pm.binary} run dev`,
      rationale: 'package.json scripts.dev present',
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.95, 'scripts.dev'),
    });
  } else if (scripts['start']) {
    runSteps.push({
      label: 'Start app',
      command: `${pm.binary} start`,
      rationale: 'package.json scripts.start present',
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.95, 'scripts.start'),
    });
  } else if (framework?.id === 'next') {
    runSteps.push({
      label: 'Run Next.js dev server',
      command: `${pm.binary} run dev`,
      rationale: 'Next.js detected; convention is `next dev`',
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.7, 'Next.js framework convention (no scripts.dev found)'),
    });
  } else if (pkg?.main && await fileExists(toAbsolute(input.root, pkg.main))) {
    // No run script — use `node <main>`. NOT `npm exec node <main>`.
    runSteps.push({
      label: 'Run entrypoint',
      command: `node ${pkg.main}`,
      rationale: `No run script in package.json; using pkg.main (${pkg.main})`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.6, 'pkg.main declared and file exists'),
    });
  } else if (input.entrypoints[0] && !input.entrypoints[0].includes(':')) {
    // Convention-based entrypoint (e.g. src/index.ts, index.js).
    // Use `node <entrypoint>` directly — never `npm exec node <entrypoint>`.
    const ep = input.entrypoints[0];
    runSteps.push({
      label: 'Run entrypoint',
      command: `node ${ep}`,
      rationale: `No run script; using discovered entrypoint ${ep}`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.45, 'Fallback to convention-based entrypoint'),
    });
  } else {
    // No run command could be inferred. Emit a note in the run plan rather
    // than a wrong command.
  }

  // Build
  if (scripts['build']) {
    buildSteps.push({
      label: 'Build',
      command: `${pm.binary} run build`,
      rationale: 'package.json scripts.build present',
      confidence: conf(0.95, 'scripts.build'),
    });
  } else if (framework?.id === 'next') {
    buildSteps.push({
      label: 'Build (Next.js)',
      command: `${pm.binary} exec next build`,
      rationale: 'Next.js detected; convention is `next build`',
      confidence: conf(0.7, 'Next.js framework convention'),
    });
  }

  // Test
  if (scripts['test']) {
    testSteps.push({
      label: 'Run tests',
      command: `${pm.binary} test`,
      rationale: 'package.json scripts.test present',
      confidence: conf(0.95, 'scripts.test'),
    });
  } else {
    const hasVitest = await fileExists(toAbsolute(input.root, 'vitest.config.ts')) ||
      await fileExists(toAbsolute(input.root, 'vitest.config.js')) ||
      await fileExists(toAbsolute(input.root, 'vitest.config.mts'));
    if (hasVitest) {
      testSteps.push({
        label: 'Run tests (vitest)',
        command: `${pm.binary} exec vitest run`,
        rationale: 'vitest config present but no scripts.test',
        confidence: conf(0.7, 'vitest config file'),
      });
    }
  }

  // Deploy targets — framework-driven, not Docker-driven (Docker is attached
  // separately by attachDockerDeploy if a root Dockerfile exists).
  const deployTargets: DeployTarget[] = [];
  if (framework?.id === 'next' || framework?.id === 'remix' || framework?.id === 'nuxt' || framework?.id === 'sveltekit') {
    deployTargets.push('vercel');
  }
  if (deployTargets.length === 0) deployTargets.push('generic-host');

  const deploySteps: PlannedCommand[] = [];
  if (deployTargets.includes('vercel') && await fileExists(toAbsolute(input.root, 'vercel.json')) === false) {
    deploySteps.push({
      label: 'Deploy to Vercel',
      command: 'vercel --prod',
      rationale: `${framework?.name} detected — Vercel is the canonical host.`,
      confidence: conf(0.65, 'Framework convention (no vercel.json found)'),
    });
  }

  return {
    installPlan: {
      steps: [installStep],
      packageManager: pm.id,
      notes: pm.id === 'npm' && pm.lockfiles.length === 0
        ? ['No lockfile found — `npm install` will create one. Commit it for reproducible installs.']
        : [],
    },
    runPlan: {
      steps: runSteps,
      entrypoint: input.entrypoints[0],
      notes: [],
    },
    buildPlan: {
      steps: buildSteps,
      notes: buildSteps.length === 0
        ? ['No build script detected — this project may not require a build step.']
        : [],
    },
    testPlan: {
      steps: testSteps,
      notes: testSteps.length === 0
        ? ['No test runner detected. Consider adding a `test` script to package.json.']
        : [],
    },
    deployPlan: {
      steps: deploySteps,
      targets: deployTargets,
      readiness: deploySteps.length ? 'partial' : 'not-ready',
      notes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

async function pythonPlans(
  input: PlannerInput,
  pm: PackageManager,
  framework: DetectedFramework | undefined,
  requiredEnv: Set<string>,
): Promise<{
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
}> {
  const installSteps: PlannedCommand[] = [];

  // Helper: returns the PM-specific run prefix (e.g. "poetry run ", "uv run ")
  // or empty string for plain pip.
  const runPrefix =
    pm.id === 'poetry' ? 'poetry run ' :
    pm.id === 'uv' ? 'uv run ' :
    pm.id === 'pipenv' ? 'pipenv run ' : '';

  switch (pm.id) {
    case 'poetry':
      installSteps.push({
        label: 'Install dependencies (Poetry)',
        command: 'poetry install',
        rationale: 'poetry.lock or [tool.poetry] detected',
        confidence: conf(0.95, 'Poetry manifest'),
      });
      break;
    case 'uv':
      installSteps.push({
        label: 'Install dependencies (uv)',
        command: 'uv sync',
        rationale: 'uv.lock or [tool.uv] detected',
        confidence: conf(0.95, 'uv manifest'),
      });
      break;
    case 'pipenv':
      installSteps.push({
        label: 'Install dependencies (Pipenv)',
        command: 'pipenv install',
        rationale: 'Pipfile detected',
        confidence: conf(0.85, 'Pipenv manifest'),
      });
      break;
    case 'pip':
    default: {
      // Prefer requirements.txt if present; otherwise `pip install .` for
      // PEP 517 builds or legacy setup.py. Never both.
      const hasReqs = pm.manifests.some((m) => m.endsWith('requirements.txt'));
      if (hasReqs) {
        installSteps.push({
          label: 'Install dependencies (pip)',
          command: 'pip install -r requirements.txt',
          rationale: 'requirements.txt present',
          confidence: conf(0.85, 'requirements.txt present'),
        });
      } else {
        // pyproject.toml with [build-system] OR legacy setup.py — install
        // the project itself.
        installSteps.push({
          label: 'Install project (pip)',
          command: 'pip install .',
          rationale: pm.manifests.some((m) => m.endsWith('setup.py'))
            ? 'setup.py detected; pip install . builds and installs the project'
            : 'pyproject.toml with [build-system] detected; no requirements.txt',
          confidence: conf(0.75, 'PEP 517 / setuptools build'),
        });
      }
      break;
    }
  }

  // Run
  // Precedence (corrected):
  //   1. Framework convention (Django manage.py, FastAPI uvicorn) — highest
  //      confidence because it matches user intent for "run the app".
  //   2. Discovered entrypoint .py file (main.py, app.py, etc.)
  //   3. Declared console-script (module:func) — last resort, since these
  //      are often CLI tools, not the app itself.
  const runSteps: PlannedCommand[] = [];
  const entrypoint = input.entrypoints[0];

  if (framework?.id === 'django') {
    runSteps.push({
      label: 'Run Django dev server',
      command: `${runPrefix}python manage.py runserver`,
      rationale: 'Django dependency detected',
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.75, 'Framework convention'),
    });
  } else if (framework?.id === 'fastapi') {
    const candidate = await firstExisting(input.root, ['main.py', 'app.py']);
    if (candidate) {
      const mod = candidate.replace(/\.py$/, '');
      runSteps.push({
        label: 'Run FastAPI app',
        command: `${runPrefix}uvicorn ${mod}:app --reload`,
        rationale: `FastAPI dependency detected; assumed uvicorn entrypoint ${mod}:app`,
        requiredEnv: Array.from(requiredEnv),
        confidence: conf(0.55, `Framework inference — verify ${mod}:app is correct`),
      });
    } else {
      runSteps.push({
        label: 'Run FastAPI app',
        command: `${runPrefix}uvicorn main:app --reload`,
        rationale: 'FastAPI dependency detected; no main.py/app.py found at root',
        requiredEnv: Array.from(requiredEnv),
        confidence: conf(0.35, 'Weak inference — no entrypoint file found'),
      });
    }
  } else if (entrypoint && entrypoint.endsWith('.py')) {
    runSteps.push({
      label: 'Run app',
      command: `${runPrefix}python ${entrypoint}`,
      rationale: `Found ${entrypoint}`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.7, 'Entrypoint file'),
    });
  } else if (entrypoint && isModuleFunc(entrypoint)) {
    // console-script form like "myapp.cli:main" — call via `python -m`.
    // Lower confidence: console scripts are often CLI tools, not the app.
    const modulePart = entrypoint.split(':')[0];
    runSteps.push({
      label: 'Run console script',
      command: `${runPrefix}python -m ${modulePart}`,
      rationale: `pyproject.toml [project.scripts] declares "${entrypoint}"`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.5, 'Declared console script (may be a CLI tool, not the app)'),
    });
  } else {
    // No run command could be inferred — leave empty rather than guess.
  }

  // Build — most Python projects do not have a build step; Poetry/uv wheel is the closest.
  const buildSteps: PlannedCommand[] = [];
  if (pm.id === 'poetry') {
    buildSteps.push({
      label: 'Build distributions (Poetry)',
      command: 'poetry build',
      rationale: 'Poetry convention',
      confidence: conf(0.8, 'Poetry build'),
    });
  } else if (pm.id === 'uv') {
    buildSteps.push({
      label: 'Build distributions (uv)',
      command: 'uv build',
      rationale: 'uv convention',
      confidence: conf(0.8, 'uv build'),
    });
  }

  // Test
  const testSteps: PlannedCommand[] = [];
  const hasPytestConfig = await fileExists(toAbsolute(input.root, 'pytest.ini')) ||
    await fileExists(toAbsolute(input.root, 'pyproject.toml')) ||
    await fileExists(toAbsolute(input.root, 'setup.cfg'));
  if (hasPytestConfig) {
    testSteps.push({
      label: 'Run tests (pytest)',
      command: `${runPrefix}pytest`,
      rationale: 'pytest configuration found',
      confidence: conf(0.8, 'pytest config'),
    });
  }

  // Deploy
  const deployTargets: DeployTarget[] = [];
  if (framework?.id === 'django' || framework?.id === 'fastapi') {
    deployTargets.push('fly', 'railway', 'render');
  }
  if (deployTargets.length === 0) deployTargets.push('generic-host');

  const deploySteps: PlannedCommand[] = [];
  if (await fileExists(toAbsolute(input.root, 'fly.toml'))) {
    deploySteps.push({
      label: 'Deploy to Fly.io',
      command: 'fly deploy',
      rationale: 'fly.toml present',
      confidence: conf(0.9, 'fly.toml'),
    });
  }

  return {
    installPlan: {
      steps: installSteps,
      packageManager: pm.id,
      notes: pm.id === 'pip' ? ['Consider migrating to uv or Poetry for reproducible installs.'] : [],
    },
    runPlan: {
      steps: runSteps,
      entrypoint: entrypoint && !isModuleFunc(entrypoint) ? entrypoint : undefined,
      notes: runSteps.length === 0
        ? ['No run command could be inferred. Common patterns: `python main.py`, `uvicorn main:app`, `python manage.py runserver`.']
        : [],
    },
    buildPlan: {
      steps: buildSteps,
      notes: buildSteps.length === 0 ? ['No build step required for this Python project.'] : [],
    },
    testPlan: {
      steps: testSteps,
      notes: testSteps.length === 0 ? ['No test runner detected.'] : [],
    },
    deployPlan: {
      steps: deploySteps,
      targets: deployTargets,
      readiness: deploySteps.length ? 'partial' : 'not-ready',
      notes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

async function goPlans(
  input: PlannerInput,
  pm: PackageManager,
  requiredEnv: Set<string>,
): Promise<{
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
}> {
  const installSteps: PlannedCommand[] = [
    {
      label: 'Download module dependencies',
      command: 'go mod download',
      rationale: 'go.mod present',
      confidence: conf(0.9, 'go.mod'),
    },
  ];

  const runSteps: PlannedCommand[] = [];
  const entrypoint = input.entrypoints[0];
  if (entrypoint) {
    runSteps.push({
      label: 'Run app',
      command: `go run ${entrypoint}`,
      rationale: `Found ${entrypoint}`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.9, 'Go entrypoint'),
    });
  }
  // If no main.go / cmd/*/main.go was found, this is likely a library —
  // emit a clear note instead of leaving the user wondering.

  const buildSteps: PlannedCommand[] = [];
  const goMod = input.manifests.find((m) => m.kind === 'go.mod');
  const moduleName =
    (goMod?.parsed as { module?: string } | undefined)?.module ?? 'app';
  const outName = path.basename(moduleName) || 'app';
  buildSteps.push({
    label: 'Build binary',
    command: `go build -o ${outName} ./...`,
    rationale: 'Standard go build invocation',
    confidence: conf(0.85, 'go build convention'),
  });

  const testSteps: PlannedCommand[] = [
    {
      label: 'Run tests',
      command: 'go test ./...',
      rationale: 'Standard go test invocation',
      confidence: conf(0.9, 'go test convention'),
    },
  ];

  return {
    installPlan: {
      steps: installSteps,
      packageManager: pm.id,
      notes: [],
    },
    runPlan: {
      steps: runSteps,
      entrypoint,
      notes: runSteps.length === 0
        ? ['No main.go or cmd/*/main.go found — this appears to be a library, not a runnable app.']
        : [],
    },
    buildPlan: {
      steps: buildSteps,
      output: outName,
      notes: [],
    },
    testPlan: {
      steps: testSteps,
      notes: [],
    },
    deployPlan: {
      steps: [],
      targets: ['generic-host'],
      readiness: 'not-ready',
      notes: ['Go binaries can deploy to any Linux host. Add a Dockerfile for portable deploys.'],
    },
  };
}

// ---------------------------------------------------------------------------
// Docker (compose-only or Dockerfile-only, no primary language)
// ---------------------------------------------------------------------------

async function dockerfilePlans(
  input: PlannerInput,
  requiredEnv: Set<string>,
): Promise<{
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
}> {
  const dockerfile = input.dockerfilePaths[0];
  const tag = 'app:latest';

  const installPlan: InstallPlan = {
    steps: [],
    packageManager: 'docker',
    notes: ['Install is handled inside the Dockerfile build step.'],
  };

  const buildSteps: PlannedCommand[] = [
    {
      label: 'Build Docker image',
      command: `docker build -f ${dockerfile} -t ${tag} .`,
      rationale: `Found root ${dockerfile}`,
      confidence: conf(0.95, 'Root Dockerfile present'),
    },
  ];

  const runSteps: PlannedCommand[] = [
    {
      label: 'Run Docker container',
      command: `docker run --rm -it${requiredEnv.size > 0 ? ' --env-file .env' : ''} -p 8080:8080 ${tag}`,
      rationale: `Built image ${tag}; port 8080 is a guess — adjust to match EXPOSE in your Dockerfile`,
      requiredEnv: Array.from(requiredEnv),
      confidence: conf(0.55, 'Standard docker run; port 8080 is a convention guess'),
    },
  ];

  return {
    installPlan,
    runPlan: { steps: runSteps, notes: [] },
    buildPlan: { steps: buildSteps, output: tag, notes: [] },
    testPlan: { steps: [], notes: ['Tests typically run inside the container — no host-side test plan inferred.'] },
    deployPlan: {
      steps: [],
      targets: ['docker', 'fly'],
      readiness: 'partial',
      notes: [],
    },
  };
}

async function composePlans(
  input: PlannerInput,
  _pm: PackageManager | undefined,
  requiredEnv: Set<string>,
): Promise<{
  installPlan: InstallPlan;
  runPlan: RunPlan;
  buildPlan: BuildPlan;
  testPlan: TestPlan;
  deployPlan: DeployPlan;
}> {
  const composeFile = input.composePaths[0];
  const buildCmd = `docker compose -f ${composeFile} build`;
  const upCmd = `docker compose -f ${composeFile} up`;
  return {
    installPlan: {
      steps: [
        {
          label: 'Build compose images',
          command: buildCmd,
          rationale: `Found ${composeFile}`,
          confidence: conf(0.92, 'Compose file present'),
        },
      ],
      packageManager: 'compose',
      notes: [],
    },
    runPlan: {
      steps: [
        {
          label: 'Start compose stack',
          command: upCmd,
          rationale: `Found ${composeFile}`,
          requiredEnv: Array.from(requiredEnv),
          confidence: conf(0.92, 'Compose file present'),
        },
      ],
      notes: [],
    },
    buildPlan: {
      steps: [
        {
          label: 'Build compose images',
          command: buildCmd,
          rationale: `Found ${composeFile}`,
          confidence: conf(0.92, 'Compose file present'),
        },
      ],
      notes: [],
    },
    testPlan: { steps: [], notes: ['Tests typically run inside the compose stack — no host-side test plan inferred.'] },
    deployPlan: {
      steps: [],
      targets: ['docker'],
      readiness: 'partial',
      notes: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Docker-as-deploy-target (used when a language is primary but Docker exists)
// ---------------------------------------------------------------------------

function attachDockerDeploy(
  input: PlannerInput,
  plan: DeployPlan,
): DeployPlan {
  const dockerfile = input.dockerfilePaths[0];
  const tag = 'app:latest';
  const step: PlannedCommand = {
    label: 'Build & push Docker image',
    command: `docker build -f ${dockerfile} -t ${tag} .`,
    rationale: `Found root ${dockerfile} — deploy by building the image and pushing to your registry.`,
    confidence: conf(0.85, 'Root Dockerfile present'),
  };
  const targets: DeployTarget[] = Array.from(new Set([...plan.targets, 'docker']));
  return {
    steps: [...plan.steps, step],
    targets,
    readiness: 'partial',
    notes: [
      ...plan.notes,
      'Docker image build is available as a deploy path. Add a deploy target config (fly.toml, render.yaml, etc.) for one-click deploys.',
    ],
  };
}

function attachComposeDeploy(
  input: PlannerInput,
  plan: DeployPlan,
): DeployPlan {
  const composeFile = input.composePaths[0];
  const step: PlannedCommand = {
    label: 'Deploy via compose',
    command: `docker compose -f ${composeFile} up -d`,
    rationale: `Found ${composeFile} — deploy by running the stack detached.`,
    confidence: conf(0.85, 'Root compose file present'),
  };
  const targets: DeployTarget[] = Array.from(new Set([...plan.targets, 'docker']));
  return {
    steps: [...plan.steps, step],
    targets,
    readiness: 'partial',
    notes: [
      ...plan.notes,
      'Compose stack is available as a deploy path.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyInstall(pm: PackageManager['id']): InstallPlan {
  return { steps: [], packageManager: pm, notes: [] };
}

/**
 * Returns true if the entrypoint string looks like a Python console-script
 * target (e.g. "mymodule.cli:main").
 */
function isModuleFunc(s: string): boolean {
  return /^[A-Za-z_][\w.]*:[A-Za-z_]\w*$/.test(s);
}

async function firstExisting(root: string, files: string[]): Promise<string | undefined> {
  for (const f of files) {
    if (await fileExists(toAbsolute(root, f))) return f;
  }
  return undefined;
}
