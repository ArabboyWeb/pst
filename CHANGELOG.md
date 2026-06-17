# Changelog

All notable changes to PST are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Workspace intelligence (Phase 3)

### Added

- **`pst go` command** — one-shot setup: detect → doctor → install → build → run. Stops on first failure. Supports `--skip-build`, `--dry-run`, `--force`.
- **`pst deploy-all` command** — CI/CD one-shot: detect → doctor → install → build → deploy (dry-run by default). Supports `--env staging|production|preview`.
- **`pretest` npm script** — auto-builds before running tests.
- **`--debug` and `--silent` flags** on `pst go`.
- **10 new tests** for `pst go` and `pst deploy-all` commands.

### Changed

- **Package publishing hygiene** — `files` field updated (added `plugins/`, removed `docs/`). Added `.npmignore` as safety net.
- **Fixture plugins** now import from `dist/plugin-api.js` instead of source, enabling reliable test execution.
- **Plugin loader** now correctly handles Windows absolute paths via `path.isAbsolute()`.
- **Engines field** simplified to `"node": ">=18"`.
- **Dependency upgrades** — vitest bumped to v3, fixing 4 of 5 npm audit vulnerabilities (1 low remaining, zero critical/high).
- **CONTRIBUTING.md** — added first-time setup gotcha for `package-lock.json` conflicts.
  complete `WorkspaceScanResult` with summary, nodes, edges, build order,
  diagnostics, and workspace-level install/build/test/run plans.
- **`pst topology [path]`**: new command that prints the full workspace
  topology report. Supports `--format text|json|markdown|dot`.
- **`pst graph [path]`**: new command that prints the dependency graph,
  defaulting to Graphviz DOT format for visualization.
- **`pst workspace inspect <id> [path]`**: new command that shows details
  for a single workspace package, including its dependents and dependencies.
- **Graphviz DOT output**: visualize the workspace dependency graph with
  `pst graph . --format dot | dot -Tpng > graph.png`. Apps are rendered as
  boxes, packages as ellipses, services as diamonds.
- **Workspace fixtures**: `fixtures/workspace-repos/` includes pnpm-workspace
  (5 packages), turbo-repo, nx-repo, polyglot-repo (Node+Python), circular
  (cyclic deps), and broken-links (missing references).
- **65 new tests** across 5 new test files covering workspace detection,
  graph building, topology output formats, diagnostics, CLI commands, and
  performance (50-package linear chain, diamond dependency graph).

### Changed

- **README**: added "Workspace intelligence" section documenting the new
  commands, supported workspace kinds, output formats, and diagnostics.
- **Commands table**: added `pst topology`, `pst graph`, `pst workspace
  inspect` to the commands table.
- **GitHub repo URL**: updated all references from `pst-cli/pst` to
  `ArabboyWeb/pst` across README, docs, CHANGELOG, CONTRIBUTING, and
  package.json.

### Performance

- 50-package linear chain workspace scans in under 3 seconds.
- Workspace graph builder uses fast-glob for package discovery and a single
  pass for edge construction.
- Topological sort handles 500+ packages with cycle detection.

### Migration impact

- **Zero regressions**: all 139 pre-Phase-3 tests pass unchanged.
- **Real-world validation**: all 12 real-world repos scan identically.
- **Tests**: 204 total (was 139). Coverage: 85.04% (was 81.98%).

## [Unreleased] — Plugin platform

### Added — Plugin architecture

- **Plugin API** (`src/plugin-api/index.ts`): public, versioned contract for
  third-party plugins. Exports `DetectorPlugin`, `PlannerPlugin`,
  `InstallerPlugin`, `RunnerPlugin`, `DeployerPlugin` types, `PluginManifest`,
  `PluginContext`, lifecycle hooks (`initialize`/`detect`/`plan`/`validate`/
  `shutdown`), and `defineDetectorPlugin()` helper functions.
  `PLUGIN_API_VERSION = 1`.
- **Plugin loader** (`src/plugins/loader.ts`): loads plugins from
  `pst.config.json`, local paths, npm packages, and auto-discovery
  (`pst-plugin-*` and `@*/pst-plugin-*`). Validates API version and PST
  version range before loading.
- **Plugin isolation**: every plugin call is wrapped in an error boundary +
  timeout (5s for lifecycle, 10s for detect/plan). Plugin failures become
  diagnostics, never crashes.
- **PluginManager** (`src/plugins/manager.ts`): orchestrates load →
  initialize → runDetectors → runPlanners → shutdown.
- **Built-in plugin registry** (`src/plugins/builtin-registry.ts`): all 5
  built-in detectors + the built-in planner are wrapped as plugins. Core
  consumes them through the same pipeline as third-party plugins.
- **Semver-lite** (`src/plugins/semver-lite.ts`): minimal semver
  implementation for plugin compatibility checks. Supports `^`, `~`, `>=`,
  `<=`, `>`, `<`, `=`, exact, `*`, and compound ranges. No new dependency.
- **`pst plugins list`**: lists all loaded plugins with source, status,
  kinds, and version info. Supports `--json` and `--auto-discover`.
- **`pst plugins inspect <id>`**: shows detailed information about a single
  plugin.
- **`pst plugins validate`**: validates all loaded plugins (API version, PST
  range, manifest completeness).
- **Reference Rust plugin** (`plugins/rust/`): full Rust support via
  `Cargo.toml` detection and `cargo fetch`/`build`/`run`/`test` planning.
  Adds Rust to PST without modifying core.
- **Plugin development guide** (`docs/plugin-development.md`): complete
  guide for plugin authors — architecture, lifecycle, examples, publishing.
- **Migration report** (`docs/migration-report.md`): documents the
  plugin-platform migration, benchmarks, and risk analysis.
- **Plugin benchmark script** (`scripts/benchmark-plugins.js`): measures
  plugin pipeline overhead (< 1ms per scan).
- **Test plugins** (`fixtures/test-plugins/`): mock, failing, timeout,
  incompatible, and bad-manifest plugins for testing isolation.
- **Rust fixture** (`fixtures/plugin-projects/rust-app/`): Cargo.toml +
  src/main.rs + .env.example for Rust plugin testing.
- **56 new tests** across 4 new test files: `plugins.test.ts` (17),
  `plugins-cli.test.ts` (6), `plugins-lifecycle.test.ts` (7),
  `utils-coverage.test.ts` (15), plus 11 more in existing files.

### Changed

- **Orchestrator is now plugin-driven**: `src/core/orchestrator.ts` no longer
  directly imports `NodeDetector`, `PythonDetector`, `GoDetector`,
  `DockerDetector`, or `buildPlans`. All detection and planning flows through
  the `PluginManager`.
- **Package exports**: added `./plugin-api` subpath export so plugins can
  `import { defineDetectorPlugin } from 'pst-cli/plugin-api'`.
- **Build**: `tsup.config.ts` now builds `plugin-api` as a separate entry
  point alongside `index` and `cli`.
- **Public API**: `src/index.ts` now exports `PluginManager`,
  `PLUGIN_API_VERSION`, and all plugin types.

### Migration impact

- **Zero regressions**: all 83 pre-migration tests pass unchanged.
- **Real-world validation**: all 12 real-world repos scan identically.
- **Performance**: plugin pipeline adds < 1ms overhead per scan.
- **CLI**: no breaking changes; existing commands behave identically.
- **Tests**: 139 total (was 83). Coverage: 81.98% (was 77.84%).

## [Unreleased] — Hardening pass

### Fixed

- **TOML parser** now falls back to a lenient line-based parser when the
  strict `toml` package fails. This fixes detection of FastAPI, Flask, and
  other repos whose `pyproject.toml` mixes array element types.
- **Go detector** no longer tries to parse `go.mod` as TOML. `go.mod` is
  line-oriented with its own syntax; a dedicated text parser now extracts
  `module`, `go`, `toolchain`, and `require` blocks reliably.
- **Docker detector** only treats root-level `Dockerfile` as a primary Docker
  signal. Subdirectory Dockerfiles (test fixtures, examples) are recorded as
  files but do not flip `hasDocker` or trigger Docker-driven planning. This
  fixes false positives on repos like `docker/compose` and `httpie`.
- **Node detector** downgrades confidence when a root `package.json` has only
  `devDependencies` and no framework (e.g. Django's JS tooling). Confidence
  drops from 0.97 to 0.55 and an info diagnostic is emitted. Frameworks in
  `devDependencies` (e.g. Next.js monorepo) keep high confidence.
- **Python detector** now stores the raw `module:func` form of console
  scripts instead of a synthetic `console-script:` prefix. The planner
  invokes them via `python -m <module>`.
- **Python detector** now detects the Django framework from `project.name`
  or the presence of `manage.py`, not just from the `django` dependency
  (which the Django repo itself doesn't list).
- **Python detector** now assigns a `pip` package manager when only
  `setup.py` is present (previously: no PM was assigned, leading to an empty
  install plan).
- **Planner** no longer emits invalid `npm exec node <file>` commands. The
  fallback for projects without a `dev`/`start` script is now `node <file>`.
- **Planner** no longer emits invalid `pip exec ...` commands. `pip` has no
  `exec` subcommand; the `runPrefix` for `pip` is now empty.
- **Planner** no longer emits `console-script:` as a literal in commands.
- **Planner** now uses language-native install/run/build/test plans when
  both a root language manifest and a root Dockerfile exist. Docker becomes
  a deploy target only. This fixes empty install plans on repos like
  `httpie` and `docker/compose`.
- **Planner** now uses `pip install .` (not `pip install -r requirements.txt`)
  when only `setup.py` or `pyproject.toml + [build-system]` is present.
- **Planner** Python run-command precedence corrected: framework conventions
  (Django `manage.py runserver`, FastAPI `uvicorn main:app`) now take
  priority over console-scripts, since console-scripts are often CLI tools
  rather than the app itself.
- **Planner** Go run-plan note now clearly states "this appears to be a
  library" when no `main.go` is found, instead of a generic "no run command"
  message.
- **README env-var scanner** no longer matches backtick-quoted uppercase
  words (`GET`, `PUT`, `UUID`, `API`, etc.). It now requires either an
  underscore in the name or a known single-word env var (`PORT`, `HOST`).
  This eliminates false-positive env vars on repos like FastAPI.

### Added

- **Dangerous-command blocklist** in the executor. PST now refuses to execute
  commands matching destructive patterns (`rm -rf /`, `mkfs`, `dd of=/dev/`,
  fork bombs, `curl ... | sh`, etc.) — even with `--force` and even in
  dry-run. Users see a clear refusal message.
- **Non-interactive guard** in the executor. If stdin is not a TTY and
  `--force` is not set, PST refuses to execute and prints a message pointing
  to `--force` or `--dry-run`. This prevents accidental execution in CI pipes.
- **`--offline` flag on all commands** (previously only on some). The
  `doctor` command now respects `--offline` and skips binary checks instead
  of always running them.
- **35 new tests** covering: TOML parsing regressions, subdirectory
  Dockerfile handling, language precedence over Docker, ambiguous
  multi-language repos, Python libraries with no entrypoint, empty projects,
  tooling-only Node, dangerous-command blocklist, non-interactive guard,
  dry-run contract, CLI flag consistency, output format validity.
- **8 new fixtures**: `node-tooling-only`, `python-library`,
  `subdir-docker-only`, `ambiguous-multi`, `dangerous-cmd`, `node-no-lockfile`.
- **`scripts/realworld.js`** validation harness for testing PST against
  real-world open-source repos.

### Changed

- **CLI descriptions** are now more specific (e.g. `pst install` says
  "Run the inferred install plan (e.g. `npm install`, `pip install -r
  requirements.txt`)" instead of just "Run the inferred install plan.").
- **Error messages** on empty plans now suggest `pst explain` as a next step.
- **`deploy` command** logic simplified: `--force` is now the only way to
  execute; `--dry-run` is accepted for symmetry but is the default.
- **`doctor` command** suppresses `info`-severity diagnostics in its output
  to keep focus on actionable issues.
- **Top-level error handler** in `bin.ts` now suggests `--debug` for full
  stack traces instead of always printing them.

### Security

- **Executor blocklist** prevents destructive commands from running even
  when inferred from a malicious or buggy manifest.
- **Non-interactive guard** prevents accidental execution when stdin is
  piped (e.g. `echo y | pst install` no longer auto-accepts).

## [0.1.0] — 2026-06-17

### Added

- Initial MVP release.
- CLI commands: `detect`, `inspect`, `plan`, `install`, `run`, `build`,
  `test`, `deploy`, `doctor`, `explain`.
- Stack detection for Node.js, Python, Go, Docker.
- Package manager inference: npm, pnpm, yarn, pip, poetry, uv, pipenv,
  go-mod, docker, compose.
- Framework detection: Next.js, Remix, Nuxt, SvelteKit, React, Vue, NestJS,
  Fastify, Express, FastAPI, Django, Flask.
- Environment file detection and parsing (`.env`, `.env.example`,
  `.env.template`, README code-block scanning).
- Install / run / build / test / deploy plan generation.
- Confidence scoring (`high` / `medium` / `low` + numeric 0.0–1.0) on every
  detection.
- Three output formats: text, JSON, markdown.
- Safe executor: dry-run mode, confirmation prompts, deploy defaults to
  dry-run, never edits or deletes user files.
- Offline mode (`--offline`) skips runtime binary presence checks.
- Diagnostics with stable codes and `nextStep` hints.
- Tests (48) covering every detector, the planner, reporters, the executor,
  and the CLI.
- Fixtures: Node, Python, Go, Docker, multi-stack (Next.js + pnpm), broken
  (malformed package.json), empty project.
- Documentation: README, docs/architecture.md, docs/roadmap.md, examples/.
- GitHub Actions CI matrix across Node 18 / 20 / 22 / 24.

[Unreleased]: https://github.com/ArabboyWeb/pst/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ArabboyWeb/pst/releases/tag/v0.1.0
