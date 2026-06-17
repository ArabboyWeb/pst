# PST Report — /home/z/my-project/pst/fixtures/multi-stack

- Scanned at: `2026-06-17T04:39:57.738Z`
- Overall confidence: **high** (0.96)

## Languages
- **Node.js**  — _high_ (0.97)
  - evidence: package.json, pnpm-lock.yaml

## Frameworks
- **Next.js** — _high_ (0.95)
  - evidence: dep:next, next.config.mjs
- **React** — _high_ (0.75)
  - evidence: dep:react

## Package managers
- **pnpm** (binary: `pnpm`) — _high_ (0.95)
  - lockfiles: pnpm-lock.yaml

## Manifests
- `package.json` (package.json)

## Install plan
- **Install dependencies** — _high_ (0.92)
  - ```sh
    pnpm install
    ```
  - _why:_ Found pnpm lockfile (pnpm-lock.yaml).

## Run plan
- **Run dev server** — _high_ (0.95)
  - ```sh
    pnpm run dev
    ```
  - _why:_ package.json scripts.dev present

## Build plan
- **Build** — _high_ (0.95)
  - ```sh
    pnpm run build
    ```
  - _why:_ package.json scripts.build present

## Test plan
- **Run tests** — _high_ (0.95)
  - ```sh
    pnpm test
    ```
  - _why:_ package.json scripts.test present

## Deploy plan
- targets: vercel
- readiness: **partial**
- Deploy to Vercel — _medium_ (0.65)
  - ```sh
    vercel --prod
    ```

