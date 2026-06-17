# PST Report — /home/z/my-project/pst/fixtures/subdir-docker-only

- Scanned at: `2026-06-17T04:39:59.721Z`
- Overall confidence: **low** (0)

## Languages
_(none detected)_

## Frameworks
_(none detected)_

## Package managers
_(none detected)_

## Manifests
_(none)_

## Install plan
_(none)_

## Run plan
_(none)_
- _note: No run plan: unsupported stack._

## Build plan
_(none)_
- _note: No build plan: unsupported stack._

## Test plan
_(none)_
- _note: No test plan: unsupported stack._

## Deploy plan
- targets: unknown
- readiness: **not-ready**
- _note: No deploy plan: unsupported stack._

## Diagnostics
- [i] `docker.subdirectory-only` Found 1 Dockerfile(s) in subdirectories but none at the project root.
  - fix: Subdirectory Dockerfiles are treated as test fixtures and do not trigger Docker planning. Add a root Dockerfile if this project should be built as a container.
- [x] `plan.no-stack` PST could not identify a supported stack to plan against.
  - fix: Add a package.json, pyproject.toml/requirements.txt, go.mod, or root Dockerfile at the project root and re-run.
