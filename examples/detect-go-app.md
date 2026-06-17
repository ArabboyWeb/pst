# PST Report — /home/z/my-project/pst/fixtures/go-app

- Scanned at: `2026-06-17T04:39:56.570Z`
- Overall confidence: **high** (0.97)

## Languages
- **Go** (requires 1.22) — _high_ (0.97)
  - evidence: go.mod

## Frameworks
_(none detected)_

## Package managers
- **Go modules** (binary: `go`) — _high_ (0.97)

## Manifests
- `go.mod` (go.mod)

## Environment
- `.env.example` (example)
  - `PORT`=`8080` _(required)_

## Entrypoints
- `main.go`

## Install plan
- **Download module dependencies** — _high_ (0.9)
  - ```sh
    go mod download
    ```
  - _why:_ go.mod present

## Run plan
- **Run app** — _high_ (0.9)
  - ```sh
    go run main.go
    ```
  - _why:_ Found main.go

## Build plan
- **Build binary** — _high_ (0.85)
  - ```sh
    go build -o go-app ./...
    ```
  - _why:_ Standard go build invocation

## Test plan
- **Run tests** — _high_ (0.9)
  - ```sh
    go test ./...
    ```
  - _why:_ Standard go test invocation

## Deploy plan
- targets: generic-host
- readiness: **not-ready**
- _note: Go binaries can deploy to any Linux host. Add a Dockerfile for portable deploys._

