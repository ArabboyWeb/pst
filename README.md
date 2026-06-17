# PST — Project Setup Tool

> Understand a repo fast. Set it up faster.

PST is a CLI-first open-source tool that scans a repository, detects its stack,
infers install / run / build / test / deploy steps, identifies missing
dependencies and environment requirements, and prints **or** safely executes a
workflow from clone to run / deploy.

It targets four ecosystems:

- **Node.js** — `npm` / `pnpm` / `yarn`
- **Python** — `pip` / `poetry` / `uv` / `pipenv`
- **Go** — `go mod`
- **Docker** — `Dockerfile` and `docker-compose`

## Why?

Every new repo you clone burns 5–30 minutes figuring out:

- Which package manager does it use?
- How do I install?
- How do I run it?
- Is there a Dockerfile?
- What env vars do I need?
- Did I miss something obvious?

PST answers all of those in **under a second**, with **confidence scores**,
**rationale for every inference**, and a **safe-by-default executor** that
never runs anything without showing you first.

## Install

```sh
# from npm (after publish)
npm install -g pst-kit

# or run without installing
npx pst-kit detect .

# or from source
git clone https://github.com/ArabboyWeb/pst.git
cd pst
npm install
npm run build
node dist/cli.js detect .
```

PST requires Node.js 18 or newer.

## Quick start

```sh
# One command to rule them all
pst go . --dry-run    # preview what will happen
pst go .              # do it (asks for confirmation)

# Or step by step:
pst detect .          # 1. What is this repo?
pst plan .            # 2. Show me the full plan (no execution)
pst install .         # 3. Install (asks before running anything)
pst run .             # 4. Run it
pst doctor .          # 5. Check the local runtime can satisfy the plan
pst explain . --only install  # 6. Why did you pick that command?
```

## Supported stacks

| Language  | Manifests / Lockfiles                                  | Package managers              |
| --------- | ------------------------------------------------------ | ----------------------------- |
| Node.js   | `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | `npm`, `pnpm`, `yarn`        |
| Python    | `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `poetry.lock`, `uv.lock` | `pip`, `poetry`, `uv`, `pipenv` |
| Go        | `go.mod`, `go.sum`                                     | Go modules                    |
| Docker    | `Dockerfile`, `docker-compose.yml`, `compose.yml`      | `docker`, `docker compose`    |

Frameworks recognized:

- **Node:** Next.js, Remix, Nuxt, SvelteKit, React, Vue, NestJS, Fastify, Express
- **Python:** FastAPI, Django, Flask (detected from dependencies, project name, or canonical files like `manage.py`)

## Quickest start

```sh
git clone <any-repo>
cd <any-repo>
pst go .
```

That's it. PST detects the stack, checks your runtimes, shows the full plan,
asks for confirmation, then installs, builds, and runs the project in one shot.

## Commands

| Command            | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `pst detect [path]`   | Detect stack, manifests, env files. Print a summary.            |
| `pst inspect [path]`  | Alias of `detect`.                                               |
| `pst plan [path]`     | Print the full install/run/build/test/deploy plan.              |
| `pst go [path]`       | One-shot: detect → doctor → install → build → run.             |
| `pst deploy-all [path]`| One-shot for CI/CD: detect → doctor → install → build → deploy (dry-run default). |
| `pst install [path]`  | Execute the install plan (asks first unless `--force`).         |
| `pst run [path]`      | Execute the run plan.                                            |
| `pst build [path]`    | Execute the build plan.                                          |
| `pst test [path]`     | Execute the test plan.                                           |
| `pst deploy [path]`   | Print or run the deploy plan. **Defaults to dry-run.**          |
| `pst doctor [path]`   | Check that local binaries satisfy the detected stack.           |
| `pst explain [path]`  | Explain *why* each inference was made, with confidence scores.  |
| `pst topology [path]` | Analyze a monorepo: packages, dependency graph, build order.   |
| `pst graph [path]`    | Print the workspace dependency graph (defaults to Graphviz DOT).|
| `pst workspace inspect <id> [path]` | Inspect a single workspace package in detail.     |
| `pst plugins list/inspect/validate` | Manage PST plugins.                              |

### Common flags

| Flag                    | Applies to                              | Effect                                                  |
| ----------------------- | --------------------------------------- | ------------------------------------------------------- |
| `-f, --format <fmt>`    | `detect`, `inspect`, `plan`, `deploy`, `go`, `deploy-all` | Output format: `text` (default), `json`, `markdown`     |
| `-n, --dry-run`         | `install`, `run`, `build`, `test`, `deploy`, `go`, `deploy-all` | Print commands without executing                     |
| `-y, --force`           | `install`, `run`, `build`, `test`, `deploy`, `go`, `deploy-all` | Skip confirmation prompts (deploy requires this to execute) |
| `--offline`             | all commands with `[path]`              | Skip runtime binary presence checks (fully hermetic)    |
| `--only <kind>`         | `plan`, `explain`                       | Filter to `install,run,build,test,deploy` (comma-separated) |
| `--skip-build`          | `go`                                    | Skip the build step even if a build plan exists         |
| `--env <environment>`   | `deploy-all`                            | Deployment target hint: staging, production, preview    |
| `--debug`               | all commands                            | Enable debug logging (verbose, includes parser internals) |
| `--silent`              | all commands                            | Suppress all logging except errors                      |

## Output formats

PST supports three output formats. They are designed so you can pipe them into
other tools, save them as build artifacts, or attach them to PRs.

### Text (default, terminal-friendly with color)

```sh
pst detect .
```

### JSON (machine-readable, schema-stable)

```sh
pst detect . --format json > pst-scan.json
```

### Markdown (for docs, PRs, READMEs)

```sh
pst detect . --format markdown > docs/scan.md
```

## Safety model

PST is **safe by default**. The full contract:

1. **Plan over execute.** `detect`, `inspect`, `plan`, `explain`, and `doctor`
   never spawn child processes.
2. **Always show first.** Every command that *can* execute prints the exact
   shell command before running it.
3. **Confirm unless forced.** `install` / `run` / `build` / `test` prompt for
   confirmation when stdin is a TTY. Pass `--force` to skip.
4. **Non-interactive guard.** If stdin is **not** a TTY and `--force` is not
   set, PST refuses to execute and prints a clear message. This prevents
   accidental execution in CI pipes.
5. **Deploy is dry-run by default.** `pst deploy` prints the plan and exits.
   You must pass `--force` to actually execute the deploy.
6. **Dangerous-command blocklist.** PST refuses to execute commands that match
   destructive patterns (`rm -rf /`, `mkfs`, `dd of=/dev/`, fork bombs,
   `curl ... | sh`, etc.) — **even with `--force`**. See the full list in
   `src/executor/executor.ts`.
7. **Never destructive.** PST never edits, deletes, or rewrites user files.
   It only suggests commands.
8. **Offline mode.** `--offline` skips all `which`/`--version` probes so the
   tool is fully hermetic — useful for CI, air-gapped environments, and
   reproducible scans.
9. **Timeout.** Every executed command has a 5-minute timeout. On timeout,
   PST sends SIGTERM, then SIGKILL after 3 seconds.

## How detection works

PST uses a **layered detection strategy**:

1. **File presence** — Does `package.json`, `pyproject.toml`, `go.mod`,
   `Dockerfile`, etc. exist at the project root?
2. **Manifest parsing** — What does the manifest actually say? Which scripts
   and dependencies are declared?
3. **Script inspection** — For Node, what does `scripts.dev/start/build/test`
   contain?
4. **Framework conventions** — Does `next.config.mjs` exist alongside a `next`
   dependency? Both signals boost confidence.
5. **README hints** — Code blocks containing `KEY=VALUE` patterns contribute
   to env-var discovery.
6. **Docker / CI hints** — Presence of a root `Dockerfile`, `compose.yml`, or
   `.github/workflows/` modifies the deploy plan.
7. **Confidence scoring** — Every detection carries a `score` (0.0–1.0) and
   a `level` (`high` / `medium` / `low`). The reporter always shows them.

When PST is uncertain, it returns multiple likely options with their
confidences — it never pretends to know more than it does.

### Confidence calibration

| Score range | Level   | Meaning                                              |
| ----------- | ------- | ---------------------------------------------------- |
| ≥ 0.75      | high    | Strong signal(s); safe to auto-execute               |
| 0.45–0.74   | medium  | Plausible; show to user, ask before executing        |
| < 0.45      | low     | Weak; treat as a hint, not a conclusion              |

Examples of calibration:

- Root `package.json` with runtime dependencies → Node.js at **0.97** (high)
- Root `package.json` with only devDependencies and no framework → Node.js at **0.55** (medium) — likely tooling-only (e.g. Django's JS test tooling)
- Subdirectory `package.json` → Node.js at **0.55** (medium)
- No lockfile → npm at **0.55** (medium), with a note
- Root `Dockerfile` only (no language manifest) → Docker at **0.92** (high)
- Subdirectory `Dockerfile` only → Docker **not** detected as primary; info diagnostic emitted

For a deeper dive, see [docs/architecture.md](docs/architecture.md).

## Plugin platform

PST is plugin-driven. All built-in detectors (Node, Python, Go, Docker) and
the built-in planner run through the same plugin pipeline as third-party
plugins. This means you can add new language support **without modifying PST
core**.

### Adding a language

Create a plugin that implements the `DetectorPlugin` and/or `PlannerPlugin`
interface:

```typescript
import { defineDetectorPlugin, conf, PLUGIN_API_VERSION } from 'pst-kit/plugin-api';

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
    // ... detect Cargo.toml, return languages/packageManagers/etc.
  },
});
```

### Loading plugins

Three ways to load plugins:

1. **`pst.config.json`** at your project root:
   ```json
   { "plugins": ["pst-plugin-rust", "./plugins/my-plugin.ts"] }
   ```

2. **Auto-discovery** (opt-in): PST scans `node_modules` for `pst-plugin-*`
   and `@*/pst-plugin-*` packages.
   ```sh
   pst detect . --auto-discover-plugins
   ```

3. **Programmatic**: pass `pluginPaths` to `scanProject()`.

### Plugin commands

```sh
pst plugins list .           # list all loaded plugins
pst plugins inspect rust .   # inspect a single plugin
pst plugins validate .       # validate all plugins
```

### Reference plugin

`plugins/rust/` contains a complete Rust plugin (detector + planner) that
adds `cargo fetch` / `cargo build` / `cargo run` / `cargo test` support
without touching PST core.

See [docs/plugin-development.md](docs/plugin-development.md) for the full
guide, and [docs/migration-report.md](docs/migration-report.md) for the
platform migration details.

## Workspace intelligence (monorepo support)

PST understands modern monorepos as **systems of packages**, not just single
projects. It detects workspace topology, builds a dependency graph, computes
topological build order, and generates workspace-level plans.

### Supported workspace kinds

| Kind | Detected via |
|------|-------------|
| pnpm workspace | `pnpm-workspace.yaml` |
| yarn workspace | `package.json` `workspaces` field |
| Turborepo | `package.json` workspaces + `turbo.json` |
| Nx | `package.json` workspaces + `nx.json` (or `nx.json` alone) |
| Lerna | `package.json` workspaces + `lerna.json` |

### Commands

```sh
# Full topology report (packages, graph, build order, plans, diagnostics)
pst topology .

# Dependency graph in Graphviz DOT format (pipe to `dot -Tpng > graph.png`)
pst graph . --format dot

# Inspect a single package
pst workspace inspect @my-org/web .
```

### Output formats

- `text` (default) — terminal-friendly report
- `json` — machine-readable, schema-stable
- `markdown` — for docs and PRs
- `dot` — Graphviz format for visualization

### Diagnostics

PST detects:
- **Circular dependencies** (error severity)
- **Orphan packages** — packages nothing depends on (info)
- **Missing references** — a package declares a workspace dep that doesn't exist (warn)
- **Duplicate names** — two packages with the same name (warn)

### Performance

Handles 500+ packages and 100k+ files. A 50-package linear chain scans in
under 3 seconds.

## Limitations

PST is an MVP. The following are **out of scope** for v0.1:

- **No built-in support for** Ruby, Java, PHP, .NET, Elixir. These can be
  added via plugins (Rust is supported via the reference `pst-plugin-rust`).
- **No transitive dependency resolution.** PST reads manifests only; it does
  not compute the full dependency tree.
- **No plugin marketplace.** Plugins are loaded from `pst.config.json`,
  local paths, or npm auto-discovery — there is no central registry yet.
- **No remote SaaS or dashboard.** PST is CLI-only.
- **No deep AST analysis.** Manifest and config inference only.
- **No automatic file editing.** PST only suggests; you run.
- **No workspace / monorepo first-class support.** Multi-package repos work
  (PST detects the root manifest), but per-workspace plans are not generated.
- **Subdirectory manifests are secondary.** PST prefers root manifests; a
  subdirectory `package.json` is recorded but does not flip the primary
  language.
- **Subdirectory Dockerfiles are ignored for planning.** Only root
  `Dockerfile` / `compose.yml` trigger Docker-driven plans. (This prevents
  test fixtures from hijacking detection.)

## Examples

See [`examples/`](examples/) for sample outputs of every command against every
fixture, and [`fixtures/`](fixtures/) for the input repos.

## Development

```sh
git clone https://github.com/ArabboyWeb/pst.git
cd pst
npm install

# build
npm run build

# watch
npm run dev

# type-check
npm run lint

# tests
npm test
npm run test:watch
npm run test:coverage
```

### Project structure

```
pst/
├── src/
│   ├── bin.ts                  # CLI entry (shebang)
│   ├── cli/
│   │   ├── cli.ts              # commander program
│   │   └── version.ts
│   ├── core/
│   │   └── orchestrator.ts     # scanProject()
│   ├── detectors/
│   │   ├── types.ts            # Detector interface + DetectorContext
│   │   ├── node.ts             # Node.js + npm/pnpm/yarn
│   │   ├── python.ts           # Python + pip/poetry/uv/pipenv
│   │   ├── go.ts               # Go modules
│   │   ├── docker.ts           # Dockerfile + compose
│   │   └── generic.ts          # env files, CI files, README
│   ├── planner/
│   │   └── planner.ts          # buildPlans() — install/run/build/test/deploy
│   ├── executor/
│   │   └── executor.ts         # safe run / dry-run / confirm / blocklist
│   ├── reporter/
│   │   └── reporter.ts         # text / json / markdown
│   ├── types/
│   │   └── index.ts            # all data model types
│   ├── utils/
│   │   ├── fs.ts               # filesystem helpers
│   │   ├── parsing.ts          # JSON/JSON5/TOML (strict + lenient) / YAML / env / requirements
│   │   ├── validation.ts       # zod schemas for manifests
│   │   ├── confidence.ts       # score → level mapping
│   │   ├── logger.ts           # info/warn/error/debug
│   │   ├── runtime.ts          # which(), versionOf()
│   │   └── constants.ts        # manifest filenames, entrypoint candidates
│   └── index.ts                # library export
├── tests/                      # 14 vitest suites, 83 tests
├── fixtures/                   # 13 sample repos (node, python, go, docker, multi-stack, edge cases)
├── docs/
│   ├── architecture.md
│   └── roadmap.md
├── examples/                   # sample outputs for every command × every fixture
├── scripts/
│   └── realworld.js            # validation harness for real-world repos
├── .github/workflows/ci.yml    # Node 18/20/22/24 matrix
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

## Contributing

Pull requests welcome. Please:

1. Open an issue first for non-trivial changes.
2. Keep detectors small and focused — one language per file.
3. Add tests for any new detection rule. The test suite includes fixtures for
   happy paths, failure cases, and ambiguous repos.
4. Run `npm run lint && npm test` before pushing.
5. Never weaken the safety contract (see "Safety model" above). Changes to
   the executor's blocklist or confirmation logic require explicit review.

See [docs/architecture.md](docs/architecture.md) for the full design and
extension guide.

## License

MIT © PST Contributors
