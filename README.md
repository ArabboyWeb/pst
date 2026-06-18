<div align="center">

# PST — Project Setup Tool

**Understand a repo fast. Set it up faster.**

[![npm version](https://img.shields.io/npm/v/pst-kit?color=0ea5e9&style=flat-square)](https://www.npmjs.com/package/pst-kit)
[![CI](https://img.shields.io/github/actions/workflow/status/ArabboyWeb/pst/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/ArabboyWeb/pst/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-f97316?style=flat-square)](https://nodejs.org)
[![Test coverage](https://img.shields.io/badge/tests-83%20passing-8b5cf6?style=flat-square)](tests/)

PST is a CLI that scans any repository, figures out exactly what it is, and either
tells you how to set it up — or does it for you, safely, one confirmed step at a time.

[Install](#install) · [Quick start](#quick-start) · [Commands](#commands) · [How it works](#how-detection-works) · [Plugin platform](#plugin-platform) · [Contributing](#contributing)

</div>

---

## Why?

Every repo you clone burns 5–30 minutes answering the same questions:

> *Which package manager? How do I install? How do I run it? Is there a Dockerfile? What env vars do I need? Did I miss something obvious?*

PST answers all of them **in under a second** — with confidence scores, evidence for every
inference, and a safe executor that never runs anything without showing you first.

```
$ pst detect .

PST — Project Intelligence Report
Scanned: /my-project
At:      2026-06-17T12:07:01Z
Overall: high (0.96)

Languages
  • Node.js  — high (0.97)
      evidence: package.json, package-lock.json

Frameworks
  • Express — high (0.75)
      evidence: dep:express
  • React   — high (0.75)
      evidence: dep:react

Package managers
  • npm (binary: npm) — high (0.95)
      lockfiles: package-lock.json

Install plan     $ npm install
Run plan         $ npm run dev
Build plan       $ npm run build
```

---

## Table of Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Supported stacks](#supported-stacks)
- [Commands](#commands)
- [Flags](#common-flags)
- [Output formats](#output-formats)
- [Safety model](#safety-model)
- [How detection works](#how-detection-works)
- [Monorepo support](#workspace-intelligence-monorepo-support)
- [Plugin platform](#plugin-platform)
- [Development](#development)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Install

```sh
# Global install — recommended
npm install -g pst-kit

# Run without installing
npx pst-kit detect .

# From source
git clone https://github.com/ArabboyWeb/pst.git
cd pst
npm install
npm run build
node dist/cli.js detect .
```

> **Requires Node.js 18 or newer.** Run `node --version` to check.

---

## Quick start

```sh
# Fastest possible: one command, handles everything
git clone <any-repo>
cd <any-repo>
pst go .
```

PST detects the stack, checks your local runtimes, shows the full plan, asks for
confirmation, then installs, builds, and runs the project in one shot.

**Or step by step, if you prefer full control:**

```sh
pst detect .                       # What is this repo?
pst plan .                         # Show every planned command (nothing runs)
pst doctor .                       # Does my machine have what's needed?
pst explain . --only install       # Why did you pick that install command?
pst install .                      # Install dependencies (asks first)
pst run .                          # Start the project (asks first)
```

**Preview before you commit:**

```sh
pst go . --dry-run                 # See exactly what pst go would do, execute nothing
pst deploy-all . --dry-run         # Full CI/CD chain preview
```

---

## Supported stacks

| Language | Manifests / Lockfiles | Package managers |
|---|---|---|
| **Node.js** | `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | `npm`, `pnpm`, `yarn` |
| **Python** | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `poetry.lock`, `uv.lock` | `pip`, `poetry`, `uv`, `pipenv` |
| **Go** | `go.mod`, `go.sum` | Go modules |
| **Docker** | `Dockerfile`, `docker-compose.yml`, `compose.yml` | `docker`, `docker compose` |

**Frameworks recognized:**

Node.js — Next.js, Remix, Nuxt, SvelteKit, React, Vue, NestJS, Fastify, Express

Python — FastAPI, Django, Flask (detected from dependencies, project name, or canonical files like `manage.py`)

Other languages (Rust, Ruby, Java, PHP, .NET, Elixir) are supported via the [plugin platform](#plugin-platform).

---

## Commands

### Core commands

| Command | What it does |
|---|---|
| `pst detect [path]` | Detect stack, manifests, env files. Print a full intelligence report. |
| `pst inspect [path]` | Alias of `detect`. |
| `pst plan [path]` | Print the complete install / run / build / test / deploy plan. Nothing executes. |
| `pst explain [path]` | Show *why* each inference was made, with confidence scores and evidence. |
| `pst doctor [path]` | Check that your local binaries can satisfy the detected stack. |

### Execution commands

| Command | What it does |
|---|---|
| `pst install [path]` | Run the install plan. Asks for confirmation unless `--force`. |
| `pst run [path]` | Run the run plan. Asks for confirmation unless `--force`. |
| `pst build [path]` | Run the build plan. Asks for confirmation unless `--force`. |
| `pst test [path]` | Run the test plan. Asks for confirmation unless `--force`. |
| `pst deploy [path]` | Print or run the deploy plan. **Dry-run by default.** Requires `--force` to execute. |

### One-shot commands

| Command | What it does |
|---|---|
| `pst go [path]` | **Detect → doctor → install → build → run.** One shot, one confirmation. |
| `pst deploy-all [path]` | **Detect → doctor → install → build → deploy.** Deploy is dry-run by default. For CI/CD pipelines. |

### Monorepo commands

| Command | What it does |
|---|---|
| `pst topology [path]` | Full monorepo report: packages, dependency graph, build order, diagnostics. |
| `pst graph [path]` | Print the workspace dependency graph (Graphviz DOT by default). |
| `pst workspace inspect <id> [path]` | Inspect a single workspace package in detail. |

### Plugin commands

| Command | What it does |
|---|---|
| `pst plugins list [path]` | List all loaded plugins. |
| `pst plugins inspect <id> [path]` | Inspect a single plugin. |
| `pst plugins validate [path]` | Validate all loaded plugins. |

---

## Common flags

| Flag | Applies to | Effect |
|---|---|---|
| `-f, --format <fmt>` | `detect`, `plan`, `go`, `deploy-all`, `topology` | Output format: `text` (default) · `json` · `markdown` |
| `-n, --dry-run` | all execution commands | Print commands without running any of them |
| `-y, --force` | all execution commands | Skip confirmation prompts. Deploy requires this to actually run. |
| `--offline` | all commands | Skip binary presence checks — useful for CI and air-gapped environments |
| `--only <kind>` | `plan`, `explain` | Filter output to `install,run,build,test,deploy` (comma-separated) |
| `--skip-build` | `go` | Skip the build step even when a build plan exists |
| `--env <environment>` | `deploy-all` | Deployment target hint: `staging` · `production` · `preview` |
| `--debug` | all commands | Verbose logging — includes parser internals |
| `--silent` | all commands | Suppress everything except errors |

---

## Output formats

All commands support three output formats — designed so you can pipe them into other
tools, save them as build artifacts, or embed them directly in PRs.

### Text (default)

Terminal-friendly, colored output. What you see in your shell every day.

```sh
pst detect .
```

### JSON — machine-readable, schema-stable

```sh
pst detect . --format json > pst-scan.json
pst plan .   --format json | jq '.plans.install'
```

### Markdown — for docs, PRs, and READMEs

```sh
pst detect . --format markdown > docs/stack-report.md
pst plan .   --format markdown >> CONTRIBUTING.md
```

### DOT — for monorepo graphs

```sh
pst graph . --format dot | dot -Tpng > dependency-graph.png
pst graph . --format dot | dot -Tsvg > dependency-graph.svg
```

---

## Safety model

PST is **safe by default**. Every part of this contract is permanent — it cannot be
overridden by configuration, and contributions that weaken it will not be merged.

**1. Plan-only commands never spawn processes.**
`detect`, `inspect`, `plan`, `explain`, and `doctor` are fully read-only. They never
start a child process, write a file, or make a network call.

**2. Always show before running.**
Every execution command prints the exact shell command before running it — no
hidden behavior.

**3. Always confirm before executing.**
`install`, `run`, `build`, and `test` prompt for confirmation when stdin is a TTY.
Pass `--force` (or `-y`) to skip.

**4. Refuses to run in non-interactive mode without `--force`.**
If stdin is not a TTY and `--force` is not set, PST refuses and prints a clear
message. This prevents silent execution in CI pipes.

**5. Deploy is dry-run by default.**
`pst deploy` prints the plan and exits. You must pass `--force` to actually execute
a deploy step.

**6. Dangerous-command blocklist — cannot be bypassed, even with `--force`.**
PST refuses to execute commands matching destructive patterns: `rm -rf /`, `mkfs`,
`dd of=/dev/`, fork bombs, `curl ... | sh`, and others. See the full list in
[`src/executor/executor.ts`](src/executor/executor.ts).

**7. PST never edits, deletes, or rewrites your files.**
It only suggests commands. You remain in full control.

**8. Offline mode.**
`--offline` skips all `which` / `--version` probes, making PST fully hermetic —
useful for CI, air-gapped environments, and reproducible scans.

**9. Timeouts.**
Every executed command has a 5-minute timeout. On timeout, PST sends `SIGTERM`,
then `SIGKILL` after 3 seconds.

---

## How detection works

PST uses a **7-layer detection strategy**, building confidence progressively:

```
Layer 1 — File presence      Does package.json / pyproject.toml / go.mod / Dockerfile exist?
Layer 2 — Manifest parsing   What does the manifest actually declare?
Layer 3 — Script inspection  What do scripts.dev / start / build / test contain?
Layer 4 — Framework signals  Does next.config.mjs exist alongside a next dependency?
Layer 5 — README hints       Code blocks with KEY=VALUE patterns → env var discovery
Layer 6 — Docker / CI hints  Root Dockerfile, compose.yml, .github/workflows/
Layer 7 — Confidence scoring Final score (0.0–1.0) and level (high / medium / low)
```

When PST is uncertain, it returns multiple likely options with their confidence scores.
It never pretends to know more than it does.

### Confidence calibration

| Score | Level | Meaning |
|---|---|---|
| ≥ 0.75 | **high** | Strong signal — safe to auto-execute |
| 0.45–0.74 | **medium** | Plausible — show to user, ask before running |
| < 0.45 | **low** | Weak hint — do not auto-execute |

**Examples:**

| Scenario | Score | Level |
|---|---|---|
| Root `package.json` with runtime deps | 0.97 | high |
| Root `package.json`, devDeps only, no framework | 0.55 | medium — likely tooling only |
| Subdirectory `package.json` only | 0.55 | medium |
| Root `Dockerfile`, no language manifest | 0.92 | high |
| No lockfile present | 0.55 | medium — inferred, not confirmed |
| Subdirectory `Dockerfile` only | — | not detected as primary; info diagnostic emitted |

For the full design, see [docs/architecture.md](docs/architecture.md).

---

## Workspace intelligence (monorepo support)

PST understands monorepos as **systems of packages** — not just single projects.
It builds a dependency graph, computes topological build order, and flags structural
problems automatically.

### Supported workspace types

| Type | Detected via |
|---|---|
| pnpm workspace | `pnpm-workspace.yaml` |
| Yarn workspace | `package.json` `workspaces` field |
| Turborepo | workspaces field + `turbo.json` |
| Nx | workspaces field + `nx.json` (or `nx.json` alone) |
| Lerna | workspaces field + `lerna.json` |

### What it detects

| Diagnostic | Severity |
|---|---|
| Circular dependencies | error |
| Missing workspace references | warn |
| Duplicate package names | warn |
| Orphan packages (nothing depends on them) | info |

### Commands

```sh
pst topology .                          # Full report: packages, graph, build order, diagnostics
pst graph . --format dot                # Graphviz DOT — pipe to dot -Tpng > graph.png
pst workspace inspect @my-org/web .     # Deep inspect one package
```

### Performance

Handles 500+ packages and 100k+ files. A 50-package linear chain scans in under 3 seconds.

---

## Plugin platform

Every built-in detector (Node, Python, Go, Docker) runs through the same plugin
pipeline as third-party plugins. You can add language support without touching PST core.

### Creating a plugin

```typescript
import { defineDetectorPlugin, PLUGIN_API_VERSION } from 'pst-kit/plugin-api';

export default defineDetectorPlugin({
  manifest: {
    id: 'rust',
    name: 'Rust',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    pstRange: '>=0.1.0',
    kinds: ['detector'],
    owns: ['rust'],
  },
  async detect(ctx) {
    const hasCargoToml = await ctx.fileExists('Cargo.toml');
    if (!hasCargoToml) return null;

    return {
      languages: [{
        name: 'Rust',
        id: 'rust',
        score: 0.97,
        evidence: ['Cargo.toml'],
      }],
    };
  },
});
```

### Loading plugins

Three ways — pick the one that fits your workflow:

**1. `pst.config.json` at your project root:**
```json
{
  "plugins": ["pst-plugin-rust", "./plugins/my-custom-plugin.ts"]
}
```

**2. npm auto-discovery (opt-in):**
```sh
pst detect . --auto-discover-plugins
```
PST scans `node_modules` for `pst-plugin-*` and `@*/pst-plugin-*` packages.

**3. Programmatic (for library users):**
```typescript
import { scanProject } from 'pst-kit';
const result = await scanProject('.', { pluginPaths: ['./my-plugin.ts'] });
```

### Reference implementation

`plugins/rust/` contains a complete Rust plugin (detector + planner) with
`cargo fetch` / `cargo build` / `cargo run` / `cargo test` support.
See [docs/plugin-development.md](docs/plugin-development.md) for the full guide.

---

## Development

```sh
git clone https://github.com/ArabboyWeb/pst.git
cd pst
npm install

npm run build          # production build (tsup)
npm run dev            # watch mode
npm run lint           # TypeScript type check
npm test               # run all 83 tests
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

> **First-time setup note:** If `git pull` fails with a `package-lock.json` conflict
> after running `npm install`, resolve it with:
> ```sh
> git stash && git pull && git stash pop && npm install
> ```

### Project structure

```
pst/
├── src/
│   ├── bin.ts                  # CLI entry (shebang)
│   ├── cli/
│   │   ├── cli.ts              # Commander program — all command definitions
│   │   └── version.ts
│   ├── core/
│   │   └── orchestrator.ts     # scanProject() — coordinates all layers
│   ├── detectors/
│   │   ├── types.ts            # Detector interface + DetectorContext
│   │   ├── node.ts             # Node.js + npm/pnpm/yarn
│   │   ├── python.ts           # Python + pip/poetry/uv/pipenv
│   │   ├── go.ts               # Go modules
│   │   ├── docker.ts           # Dockerfile + compose
│   │   └── generic.ts          # env files, CI files, README hints
│   ├── planner/
│   │   └── planner.ts          # buildPlans() — install/run/build/test/deploy
│   ├── executor/
│   │   └── executor.ts         # safe run / dry-run / confirm / blocklist
│   ├── reporter/
│   │   └── reporter.ts         # text / json / markdown output
│   ├── plugin-api/
│   │   └── index.ts            # defineDetectorPlugin, definePlannerPlugin
│   ├── types/
│   │   └── index.ts            # all shared data model types
│   └── utils/
│       ├── fs.ts               # filesystem helpers
│       ├── parsing.ts          # JSON5 / TOML / YAML / env / requirements parsing
│       ├── validation.ts       # Zod schemas for manifests
│       ├── confidence.ts       # score → level mapping
│       ├── logger.ts           # info / warn / error / debug
│       ├── runtime.ts          # which(), versionOf()
│       └── constants.ts        # manifest filenames, entrypoint candidates
├── tests/                      # 14 Vitest suites, 83 tests
├── fixtures/                   # 13 sample repos (node, python, go, docker, multi-stack, edge cases)
├── plugins/rust/               # reference Rust plugin
├── docs/
│   ├── architecture.md
│   ├── plugin-development.md
│   ├── migration-report.md
│   └── roadmap.md
├── examples/                   # sample output for every command × every fixture
├── scripts/
│   └── realworld.js            # validation harness for real-world repos
└── .github/workflows/
    ├── ci.yml                  # Node 18 / 20 / 22 / 24 matrix
    └── publish.yml             # npm publish on version tag
```

---

## Contributing

Pull requests are welcome. Before you start:

1. **Open an issue first** for any non-trivial change — discuss approach before coding.
2. **One language per detector file.** Keep detectors small and focused.
3. **Tests are required.** Every new detection rule needs a test. Fixtures live in `fixtures/`.
4. **Run `npm run lint && npm test` before pushing.** Both must pass.
5. **Never weaken the safety contract.** Changes to the executor's blocklist or confirmation
   logic require explicit review and will not be merged lightly.
6. **Confidence scores must follow the calibration table.** Do not inflate scores —
   honesty about uncertainty is a core feature, not a bug.

For a deep dive into the architecture, extension points, and design decisions,
see [docs/architecture.md](docs/architecture.md).

---

## Roadmap

PST v0.1 is a focused MVP. The following are **out of scope for this release** but
planned or plugin-solvable:

| Feature | Status |
|---|---|
| Ruby, Java, PHP, .NET, Elixir built-in detectors | Planned — or add via plugin |
| Rust built-in detector | Already available as `plugins/rust/` |
| Plugin marketplace / central registry | Planned for v0.2 |
| Transitive dependency resolution | Not planned — manifest-level is sufficient for setup |
| Per-workspace plans in monorepos | Topology analysis exists; per-package execution planned |
| Remote dashboard or SaaS | Not planned — CLI-only by design |
| Deep AST analysis | Out of scope |
| `pst init` — interactive config generator | Planned for v0.2 |
| Update check (`pst update`) | Planned for v0.2 |
| LSP / JSON Schema for `pst.config.json` | Planned |

**Known v0.1 constraints:**

- Subdirectory manifests are secondary — root manifests are always preferred.
- Subdirectory Dockerfiles do not trigger Docker planning (they are treated as fixtures).
  Add a root `Dockerfile` to enable Docker planning.

---

## License

MIT © PST Contributors

---

<div align="center">

If PST saved you time, give it a ⭐ — it helps others find it.

</div>
