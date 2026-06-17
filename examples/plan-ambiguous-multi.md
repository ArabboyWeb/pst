# PST Report — /home/z/my-project/pst/fixtures/ambiguous-multi

- Scanned at: `2026-06-17T04:40:00.219Z`
- Overall confidence: **high** (0.86)

## Languages
- **Node.js**  — _high_ (0.97)
  - evidence: package.json
- **Go** (requires 1.22) — _high_ (0.97)
  - evidence: go.mod
- **Python** (requires >=3.10) — _high_ (0.95)
  - evidence: pyproject.toml

## Frameworks
- **FastAPI** — _high_ (0.8)
  - evidence: dep:fastapi
- **Express** — _high_ (0.75)
  - evidence: dep:express

## Package managers
- **Go modules** (binary: `go`) — _high_ (0.97)
- **pip** (binary: `pip`) — _high_ (0.75)
- **npm** (binary: `npm`) — _medium_ (0.55)

## Manifests
- `package.json` (package.json)
- `pyproject.toml` (pyproject.toml)
- `go.mod` (go.mod)

## Install plan
- **Install dependencies** — _medium_ (0.55)
  - ```sh
    go install
    ```
  - _why:_ No lockfile found; using Go modules install (will create a lockfile).

## Run plan
_(none)_

## Build plan
_(none)_
- _note: No build script detected — this project may not require a build step._

## Test plan
_(none)_
- _note: No test runner detected. Consider adding a `test` script to package.json._

## Deploy plan
- targets: generic-host
- readiness: **not-ready**

