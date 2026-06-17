# PST Report — /home/z/my-project/pst/fixtures/node-app

- Scanned at: `2026-06-17T04:39:55.814Z`
- Overall confidence: **high** (0.96)

## Languages
- **Node.js** (requires >=18) — _high_ (0.97)
  - evidence: package.json, package-lock.json

## Frameworks
- **Express** — _high_ (0.75)
  - evidence: dep:express

## Package managers
- **npm** (binary: `npm`) — _high_ (0.95)
  - lockfiles: package-lock.json

## Manifests
- `package.json` (package.json)

## Environment
- `.env.example` (example)
  - `PORT`=`3000` _(required)_
  - `DATABASE_URL`=`postgres://localhost:5432/app` _(required)_
  - `JWT_SECRET` _(required)_
- `README.md` (template)
  - `PORT`=`3000`
  - `DATABASE_URL`=`postgres://localhost:5432/app`
  - `JWT_SECRET`

## Entrypoints
- `index.js`

## Install plan
- **Install dependencies** — _high_ (0.92)
  - ```sh
    npm install
    ```
  - _why:_ Found npm lockfile (package-lock.json).

## Run plan
- **Run dev server** — _high_ (0.95)
  - ```sh
    npm run dev
    ```
  - _why:_ package.json scripts.dev present

## Build plan
- **Build** — _high_ (0.95)
  - ```sh
    npm run build
    ```
  - _why:_ package.json scripts.build present

## Test plan
- **Run tests** — _high_ (0.95)
  - ```sh
    npm test
    ```
  - _why:_ package.json scripts.test present

## Deploy plan
- targets: generic-host
- readiness: **not-ready**

