/**
 * Hard-coded constants used across detectors and planners.
 */

export const NODE_MANIFEST = 'package.json';
export const NODE_LOCKFILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
] as const;

export const PYTHON_MANIFESTS = [
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'Pipfile',
] as const;
export const PYTHON_LOCKFILES = [
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
] as const;

export const GO_MANIFEST = 'go.mod';
export const GO_LOCKFILE = 'go.sum';

export const DOCKER_FILES = ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'] as const;
export const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

export const CI_FILES = [
  '.github/workflows',
  '.gitlab-ci.yml',
  '.circleci/config.yml',
  'azure-pipelines.yml',
  '.travis.yml',
  'Jenkinsfile',
] as const;

export const ENV_FILES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
] as const;

export const README_FILES = [
  'README.md',
  'README.rst',
  'README.txt',
  'README',
  'readme.md',
] as const;

/**
 * Common Node entrypoint candidates, in priority order.
 */
export const NODE_ENTRYPOINT_CANDIDATES = [
  'src/index.ts',
  'src/index.js',
  'src/main.ts',
  'src/main.js',
  'src/app.ts',
  'src/app.js',
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'server.ts',
  'server.js',
  'app.ts',
  'app.js',
];

export const PYTHON_ENTRYPOINT_CANDIDATES = [
  'main.py',
  'app.py',
  'src/main.py',
  'src/app.py',
  '__main__.py',
  'run.py',
  'manage.py',
];

export const GO_ENTRYPOINT_CANDIDATES = ['main.go', 'cmd/main.go', 'cmd/*/main.go'];
