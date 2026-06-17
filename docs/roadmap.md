# Roadmap

This document tracks the past, present, and future of PST.

## Status

- **v0.1 (MVP)** — ✅ shipped
- **v0.2** — planning
- **v0.3+** — research

## v0.1 — MVP (current)

The MVP delivers on the primary user promise — *Understand a repo fast. Set
it up faster.* — for four ecosystems:

- Node.js (npm / pnpm / yarn)
- Python (pip / poetry / uv / pipenv)
- Go (go mod)
- Docker (Dockerfile + Compose)

### Shipped

- [x] Repository scanning with fast-glob, ignoring common noise directories.
- [x] Stack detection for Node, Python, Go, Docker.
- [x] Manifest parsing (package.json, pyproject.toml, requirements.txt,
      Pipfile, go.mod, Dockerfile, compose).
- [x] Lockfile-based package manager inference.
- [x] Environment file detection and parsing (`.env`, `.env.example`, plus
      README code-block scanning).
- [x] Install / run / build / test / deploy plan generation.
- [x] Confidence scoring on every detection.
- [x] Dry-run and safe execution with confirmation prompts.
- [x] Three output formats: text, JSON, markdown.
- [x] Ten CLI commands: detect, inspect, plan, install, run, build, test,
      deploy, doctor, explain.
- [x] Diagnostics with stable codes and next-step hints.
- [x] Offline mode (`--offline`).
- [x] Tests for every detector, planner, reporter, and the CLI.
- [x] Fixtures for Node, Python, Go, Docker, multi-stack, broken, and empty
      projects.
- [x] README, architecture doc, roadmap, and example outputs.

## v0.2 — Languages & workspaces

Focus: broaden language coverage and improve monorepo support.

### Planned

- [ ] **Rust** — Cargo (`Cargo.toml`, `Cargo.lock`).
- [ ] **Ruby** — Bundler (`Gemfile`, `Gemfile.lock`).
- [ ] **Java / Kotlin (JVM)** — Gradle and Maven.
- [ ] **PHP** — Composer.
- [ ] **.NET** — `*.csproj`, `dotnet` CLI.
- [ ] **Elixir** — Mix.
- [ ] **pnpm workspaces** — first-class multi-package install/run.
- [ ] **Yarn workspaces** — same.
- [ ] **Turborepo / Nx** — task-runner integration.
- [ ] **Python monorepos** — uv workspace support.
- [ ] **Go workspaces** (`go.work`).

### Under consideration

- Better Dockerfile parsing (extract `EXPOSE`, `CMD`, env vars).
- Kubernetes manifests (`kustomization.yaml`, `Chart.yaml`) as deploy hints.
- README scraping for "## Getting started" sections to validate our plan.

## v0.3 — Plugin architecture

Focus: open up PST to community-driven detectors and planners.

### Planned

- [ ] **Plugin loader** — auto-discover `pst-detector-*` and `pst-planner-*`
      packages from `node_modules`.
- [ ] **Plugin API** — public TypeScript types and a stable versioning
      scheme.
- [ ] **Plugin registry** — a curated list on the PST website (also OSS).
- [ ] **Configuration file** — `.pst/config.json` to enable/disable plugins
      and override detected package managers per project.
- [ ] **Custom detectors in user projects** — load detectors from
      `.pst/detectors/` for project-specific stacks.

## v0.4 — Execution intelligence

Focus: smarter, safer execution.

### Planned

- [ ] **Incremental install** — detect `node_modules` / `venv` existence and
      skip if up-to-date.
- [ ] **Plan caching** — `.pst/cache.sqlite` keyed on file mtimes.
- [ ] **Watch mode** — `pst run --watch` re-runs on file changes.
- [ ] **Telemetry export** — emit OpenTelemetry spans for each step.
- [ ] **CI integration** — `pst ci` command that runs install/build/test in
      one shot with structured output for GitHub Actions / GitLab CI.
- [ ] **Container fallback** — if a runtime is missing locally, offer to
      run the plan inside Docker.

## v0.5 — Remote recipes & collaboration

Focus: shared knowledge across teams.

### Planned

- [ ] **Recipe marketplace** — community-contributed recipes for uncommon
      stacks (e.g. embedded Rust, scientific Python, HPC Go).
- [ ] **Team config** — fetch `.pst/config.json` from a shared URL or
      another branch.
- [ ] **PR comments** — GitHub Action that posts a PST scan as a comment on
      the first PR touching an unfamiliar repo.
- [ ] **Onboarding bot** — `/pst` slash command in Slack/Discord that
      returns a scan link.

## Out of scope (explicitly)

These will not be built as part of PST core, to keep the project focused:

- Web dashboard / SaaS hosting. PST stays CLI-first.
- AI model integration for code generation. PST only reads manifests; it
  does not generate code.
- IDE plugins. PST outputs JSON that any IDE can consume.
- Paid tiers. PST is MIT-licensed and will remain so.

## Versioning

PST follows semantic versioning. Until v1.0, minor versions may include
breaking changes (documented in the changelog). After v1.0, the JSON output
schema is frozen per major version.
