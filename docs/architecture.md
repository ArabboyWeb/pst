# Architecture

This document describes the internal design of PST. It is intended for
contributors and for users who want to understand *why* the tool behaves the
way it does.

## Design principles

The MVP is shaped by seven principles. Every architectural choice below
traces back to one of these.

1. **Safe by default.** No destructive action without an explicit opt-in.
2. **Helpful over clever.** Show the user the plan; let them decide.
3. **Deterministic over magical.** Same repo → same plan, every time.
4. **Transparent over hidden.** Every inference ships with a reason and a
   confidence score.
5. **Extensible from day one.** New languages should be one file plus one
   registration line.
6. **Easy for beginners, useful for experts.** Default text output is
   readable; JSON output is schema-stable for scripting.
7. **Small enough to ship, strong enough to grow.** We ship a thin MVP and
   leave clear seams for v0.2+.

## High-level data flow

```
                ┌─────────────┐
   project dir ─▶│  scanProject │── ProjectScanResult ──┐
                └─────────────┘                         │
                       │                                 │
                       ▼                                 │
              ┌──────────────────┐                       │
              │   Detectors      │                       │
              │  ┌─────────────┐ │                       │
              │  │ Node        │ │                       │
              │  │ Python      │ │                       │
              │  │ Go          │ │                       │
              │  │ Docker      │ │                       │
              │  │ Generic     │ │                       │
              │  └─────────────┘ │                       │
              └──────────────────┘                       │
                       │                                 │
                       ▼                                 │
              ┌──────────────────┐                       │
              │   Planner        │                       │
              │  (buildPlans)    │                       │
              └──────────────────┘                       │
                       │                                 │
                       ▼                                 │
              ┌──────────────────┐                       │
              │  Orchestrator    │  merge + diagnostics  │
              └──────────────────┘                       │
                       │                                 │
                       ▼                                 │
              ┌──────────────────┐                       │
              │   Reporter       │◀──────────────────────┘
              │  text/json/md    │
              └──────────────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  Executor        │  (only on install/run/build/test/deploy)
              │  dry-run/confirm │
              │  blocklist       │
              └──────────────────┘
```

## Layer responsibilities

### 1. CLI layer (`src/cli/`)

Parses arguments with Commander.js, wires options to the orchestrator /
executor / reporter, and prints results. It contains no business logic. Every
command is a thin wrapper around `scanProject()` + a renderer.

### 2. Core orchestration layer (`src/core/`)

`scanProject()` is the single entry point. It:

1. Globs the project tree (skipping `node_modules`, `.git`, `dist`, etc.).
2. Builds a `DetectorContext` shared across all detectors.
3. Runs every detector in order, merging results.
4. Sorts detections by confidence (primary language first).
5. Identifies Docker/Compose presence — **only root-level artifacts count**.
   Subdirectory Dockerfiles are recorded as files but do not flip `hasDocker`.
6. Hands the merged bundle to `buildPlans()`.
7. Pushes planner diagnostics and runtime diagnostics.
8. Computes an overall confidence from all detection confidences.

### 3. Detectors layer (`src/detectors/`)

Each detector is a class implementing:

```ts
interface Detector {
  id: string;
  name: string;
  detect(ctx: DetectorContext): Promise<DetectorResult>;
}
```

Detectors are **independent**: they never import each other. They share state
only through the `DetectorContext` (file list, claimed-files set, diagnostics
accumulator). This makes them trivial to test in isolation and easy to add.

A detector that finds nothing returns an empty `DetectorResult` — it never
throws.

#### Detection precedence rules (hardened in v0.1)

- **Root manifests win.** A root `package.json` beats a subdirectory one. A
  root `Dockerfile` beats subdirectory Dockerfiles.
- **Language beats Docker.** If a root language manifest (Node/Python/Go)
  exists AND a root Dockerfile exists, the language drives install/run/build/test,
  and Docker becomes a deploy target only.
- **Compose beats Dockerfile.** If both `Dockerfile` and `compose.yml` exist
  at root with no language manifest, compose wins (the compose file is the
  more complete artifact).
- **Tooling-only Node is downgraded.** A root `package.json` with only
  `devDependencies` and no framework is treated as a tooling stack (e.g.
  Django's JS test tooling), not the primary language. Confidence drops to
  0.55 and an info diagnostic is emitted.
- **Framework self-detection.** The Django repo's `pyproject.toml` doesn't
  list `django` as a dependency (it IS django). PST detects Django from
  `project.name == "django"` or the presence of `manage.py`.

### 4. Planner layer (`src/planner/`)

`buildPlans()` consumes the merged detector output and produces five plans:
`installPlan`, `runPlan`, `buildPlan`, `testPlan`, `deployPlan`. Each plan is
a list of `PlannedCommand` objects, where every command carries:

- `label` (human-facing name)
- `command` (exact shell string)
- `rationale` (one-sentence explanation)
- `confidence` (score + level + reason)
- `requiredEnv` (env vars the user must set)

The planner is the only place that knows about *conventions* (e.g. "Next.js
projects deploy to Vercel"). It is also the only place that emits
`PlannedCommand` objects — neither detectors nor the executor construct
commands.

#### Command inference rules (hardened in v0.1)

**Node.js:**
- Lockfile picks the PM: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
  `package-lock.json` → npm. No lockfile → npm at 0.55 confidence.
- Run: `scripts.dev` > `scripts.start` > `node <pkg.main>` > `node <entrypoint>`.
  **Never** emits `npm exec node <file>` (that was a v0.1 bug, now fixed).
- Build: `scripts.build` if present.
- Test: `scripts.test` if present; falls back to `vitest run` if a vitest
  config exists.

**Python:**
- `uv.lock` / `[tool.uv]` → `uv sync` + `uv run` prefix.
- `poetry.lock` / `[tool.poetry]` → `poetry install` + `poetry run` prefix.
- `Pipfile` → `pipenv install` + `pipenv run` prefix.
- `requirements.txt` → `pip install -r requirements.txt` (no prefix on run).
- `setup.py` or `pyproject.toml + [build-system]` with no requirements.txt →
  `pip install .`.
- Run precedence: framework convention (Django `manage.py runserver`,
  FastAPI `uvicorn main:app`) > entrypoint file (`main.py`) > console-script
  (`python -m <module>`).
- **Never** emits `pip exec ...` (pip has no `exec` subcommand — that was a
  v0.1 bug, now fixed).
- **Never** emits `console-script:` as a literal (that was a v0.1 bug, now
  fixed).

**Go:**
- `go.mod` → `go mod download` (install), `go run <entrypoint>` (run),
  `go build -o <module-basename> ./...` (build), `go test ./...` (test).
- Entrypoint: first match of `main.go`, `cmd/main.go`, `cmd/<name>/main.go`.
- If no entrypoint found, the run plan is empty with a note: "this appears to
  be a library, not a runnable app."

**Docker:**
- Compose-only: `docker compose -f <file> build` (install),
  `docker compose -f <file> up` (run).
- Dockerfile-only (no language): `docker build -f <file> -t app:latest .`
  (build), `docker run --rm -it --env-file .env -p 8080:8080 app:latest` (run).
- Language + root Dockerfile: language plans + Docker deploy step appended.

### 5. Executor layer (`src/executor/`)

The executor is the **only** place that spawns child processes. Its safety
contract (hardened in v0.1):

1. **Blocklist check first.** Refuse commands matching `DANGEROUS_PATTERNS`
   (see below) — always, even in dry-run, even with `--force`.
2. **Dry-run short-circuit.** If `dryRun: true`, print and return ok, never
   spawn.
3. **Non-interactive guard.** If `force: false` AND stdin is not a TTY,
   abort with a clear message. This prevents accidental execution in CI
   pipes where the prompt would hang or auto-accept.
4. **Confirmation prompt.** If `force: false` AND stdin is a TTY, prompt
   with enquirer. User can choose yes / no / show-shell-equivalent.
5. **Live streaming.** Child stdout/stderr stream to the terminal (stderr)
   so the user sees live progress. They are also buffered into the result.
6. **Timeout.** 5-minute default. On timeout: SIGTERM, then SIGKILL after 3s.

#### Dangerous-command blocklist

```
rm -rf /<top-level>        rm -rf *                  :(){ fork bomb
mkfs                       dd of=/dev/               chmod -R 777 /
shutdown/reboot/halt       --no-preserve-root        > /dev/sd[a-z]
curl ... | sh              wget ... | sh
```

The blocklist is intentionally over-matched (false positives are fine; false
negatives are not). Users who genuinely need to run these commands can do so
outside PST.

The executor never constructs commands — it only consumes `PlannedCommand`
objects produced by the planner.

### 6. Reporter layer (`src/reporter/`)

Renders a `ProjectScanResult` as `text`, `json`, or `markdown`. Reporters are
pure functions: same input → same output. They never log; they return a
string that the CLI writes to stdout.

### 7. Utilities layer (`src/utils/`)

Shared helpers:

- **`fs.ts`** — filesystem wrappers (fileExists, dirExists, readText, globInProject)
- **`parsing.ts`** — JSON, JSON5, TOML (strict + lenient fallback), YAML, env, requirements.txt
- **`validation.ts`** — zod schemas for package.json, pyproject.toml, go.mod
- **`confidence.ts`** — score → level mapping, averaging
- **`logger.ts`** — info/warn/error/debug, all to stderr (stdout reserved for reports)
- **`runtime.ts`** — which(), versionOf() binary probes
- **`constants.ts`** — manifest filenames, entrypoint candidates

#### TOML lenient fallback

The strict `toml` npm package rejects some real-world `pyproject.toml` files
that mix array element types (e.g. FastAPI's). PST's `parseTomlFile()` tries
strict first, then falls back to a lenient line-based parser that recovers
the fields PST cares about: section headers, key=value, string arrays, and
inline tables. The fallback is not a general TOML parser — it is intentionally
narrow.

## Detection strategy

PST uses a layered strategy, applied in order. Each layer can either
*confirm* or *boost* a detection.

| Layer | What it looks at                                       | Example                                          |
| ----- | ------------------------------------------------------ | ------------------------------------------------ |
| 1     | File presence (glob, root-preferred)                   | root `package.json` → Node.js is likely          |
| 2     | Manifest parsing (zod-validated, lenient TOML fallback) | `package.json.scripts.dev` → run command hint  |
| 3     | Script inspection                                      | `next.config.mjs` + `next` dep → Next.js (high)  |
| 4     | Framework conventions                                  | `pyproject.toml [tool.poetry]` → Poetry          |
| 5     | README hints                                           | Code block with `KEY=value` → env var discovery  |
| 6     | Docker / CI hints                                      | root `Dockerfile` + `compose.yml` → prefer compose |
| 7     | Confidence scoring                                     | Multiple signals → higher score                  |

## Confidence model

Every detected item carries a `Confidence`:

```ts
interface Confidence {
  score: number;        // 0.0 to 1.0
  level: 'high' | 'medium' | 'low';
  reason: string;       // one short sentence
}
```

Thresholds:

| Level  | Score range | Meaning                                       |
| ------ | ----------- | --------------------------------------------- |
| high   | ≥ 0.75      | Strong signal(s); safe to auto-execute        |
| medium | 0.45–0.74   | Plausible; show to user, ask before executing |
| low    | < 0.45      | Weak; treat as a hint, not a conclusion       |

The overall scan confidence is the average of all per-detection confidences.
A scan with no detections scores 0.

## Error handling

- All errors carry a stable `code` (e.g. `node.invalid-package-json`).
- `error` severity diagnostics set the CLI's exit code to 1.
- `warn` severity diagnostics print to stderr but do not affect exit code.
- `info` severity diagnostics are omitted from `doctor` output to keep it
  focused on actionable issues.
- Stack traces are hidden unless `--debug` is set.
- Every error includes a concrete `nextStep` when possible.

### Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Success                                                |
| 1    | Scan completed with error-severity diagnostics, or execution failed |
| 2    | Command ran but no plan could be generated (e.g. `pst install` on an empty project) |

## Extension strategy

### Adding a language

1. Create `src/detectors/<lang>.ts` implementing `Detector`.
2. Register it in `src/core/orchestrator.ts`.
3. Add a `<lang>Plans()` function in `src/planner/planner.ts` and dispatch
   from `buildPlans()`.
4. Add fixtures under `fixtures/<lang>-app/`.
5. Add tests under `tests/<lang>-detector.test.ts`.

The detector interface is intentionally small. A detector only needs to
populate `languages`, `packageManagers`, `manifests`, `frameworks`, `env`, and
`entrypoints`. The planner takes it from there.

### Adding a framework

Add a row to `FRAMEWORK_SIGNATURES` in the relevant detector. No other
changes are required for detection; planner integration is only needed if the
framework changes install/run/build/test commands or deploy targets.

### Adding a deploy target

Add a case to `deployTargets` in the relevant `<lang>Plans()` function. If
the target requires a config file (e.g. `fly.toml`), check for its presence
and gate the deploy step on it.

## Testing strategy

Tests live in `tests/` and use Vitest. The suite includes:

- **Per-detector tests** — isolated fixture-based contexts.
- **End-to-end tests** (`scan-project.test.ts`) — full pipeline against every fixture.
- **Regression tests** (`regressions.test.ts`) — covers bugs found during
  real-world validation: TOML parsing, subdirectory Dockerfiles, language
  precedence, ambiguous multi-language repos, Python libraries, empty projects.
- **Hardening tests** (`*-hardening.test.ts`) — covers safety flags,
  dangerous-command blocklist, non-interactive guard, dry-run contract, CLI
  consistency.
- **Reporter tests** — text/JSON/markdown output validity.
- **Executor tests** — real command execution, exit codes, stdout capture.

Fixtures are deliberately minimal but realistic. They double as `examples/`
material. The fixture set includes happy paths (node-app, python-app, go-app,
docker-app), edge cases (empty-project, broken-node, node-tooling-only,
python-library, subdir-docker-only, ambiguous-multi, node-no-lockfile), and
multi-stack (multi-stack = Next.js + pnpm).

## Future architecture (post-MVP)

- **Plugin system** — load detectors and planners from `node_modules`
  packages named `pst-detector-*` and `pst-planner-*`.
- **Caching** — incremental scans via a `.pst/cache.sqlite` file keyed on
  file mtimes.
- **Workspace support** — first-class handling of monorepos and pnpm
  workspaces.
- **Remote recipes** — fetch shared deploy recipes from a community repo
  (gated behind `--remote`).
- **AST analysis** — for languages where manifest inference is insufficient
  (e.g. Rust crates with build.rs customizations).

None of these are in the MVP. The current architecture has clean seams for
all of them.
