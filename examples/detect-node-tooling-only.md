# PST Report — /home/z/my-project/pst/fixtures/node-tooling-only

- Scanned at: `2026-06-17T04:39:58.538Z`
- Overall confidence: **medium** (0.55)

## Languages
- **Node.js**  — _medium_ (0.55)
  - evidence: package.json

## Frameworks
_(none detected)_

## Package managers
- **npm** (binary: `npm`) — _medium_ (0.55)

## Manifests
- `package.json` (package.json)

## Install plan
- **Install dependencies** — _medium_ (0.55)
  - ```sh
    npm install
    ```
  - _why:_ No lockfile found; using npm install (will create a lockfile).
- _note: No lockfile found — `npm install` will create one. Commit it for reproducible installs._

## Run plan
_(none)_

## Build plan
_(none)_
- _note: No build script detected — this project may not require a build step._

## Test plan
- **Run tests** — _high_ (0.95)
  - ```sh
    npm test
    ```
  - _why:_ package.json scripts.test present

## Deploy plan
- targets: generic-host
- readiness: **not-ready**

## Diagnostics
- [i] `node.tooling-only` package.json at root has no "dependencies" field and no framework in devDependencies — treating Node as a tooling stack, not the primary language.
  - file: `package.json`
  - fix: If Node is actually the primary language, add runtime dependencies or a framework to package.json.
