# PST Report — /home/z/my-project/pst/fixtures/docker-app

- Scanned at: `2026-06-17T04:39:57.241Z`
- Overall confidence: **high** (0.86)

## Languages
- **Node.js**  — _high_ (0.97)
  - evidence: package.json
- **Docker**  — _high_ (0.97)
  - evidence: Dockerfile, docker-compose.yml

## Frameworks
- **Express** — _high_ (0.75)
  - evidence: dep:express

## Package managers
- **Docker Compose** (binary: `docker compose`) — _high_ (0.97)
- **npm** (binary: `npm`) — _medium_ (0.55)

## Manifests
- `package.json` (package.json)
- `docker-compose.yml` (docker-compose.yml)
- `Dockerfile` (Dockerfile)

## Environment
- `.env.example` (example)
  - `PORT`=`3000` _(required)_

## Entrypoints
- `index.js`

## Install plan
- **Install dependencies** — _medium_ (0.55)
  - ```sh
    docker compose install
    ```
  - _why:_ No lockfile found; using Docker Compose install (will create a lockfile).

## Run plan
- **Start app** — _high_ (0.95)
  - ```sh
    docker compose start
    ```
  - _why:_ package.json scripts.start present

## Build plan
_(none)_
- _note: No build script detected — this project may not require a build step._

## Test plan
_(none)_
- _note: No test runner detected. Consider adding a `test` script to package.json._

## Deploy plan
- targets: generic-host, docker
- readiness: **partial**
- Build & push Docker image — _high_ (0.85)
  - ```sh
    docker build -f Dockerfile -t app:latest .
    ```
- _note: Docker image build is available as a deploy path. Add a deploy target config (fly.toml, render.yaml, etc.) for one-click deploys._

