# PST Report — /home/z/my-project/pst/fixtures/python-library

- Scanned at: `2026-06-17T04:39:59.036Z`
- Overall confidence: **high** (0.85)

## Languages
- **Python** (requires >=3.10) — _high_ (0.95)
  - evidence: pyproject.toml

## Frameworks
_(none detected)_

## Package managers
- **pip** (binary: `pip`) — _high_ (0.75)

## Manifests
- `pyproject.toml` (pyproject.toml)

## Install plan
- **Install project (pip)** — _high_ (0.75)
  - ```sh
    pip install .
    ```
  - _why:_ pyproject.toml with [build-system] detected; no requirements.txt
- _note: Consider migrating to uv or Poetry for reproducible installs._

## Run plan
_(none)_
- _note: No run command could be inferred. Common patterns: `python main.py`, `uvicorn main:app`, `python manage.py runserver`._

## Build plan
_(none)_
- _note: No build step required for this Python project._

## Test plan
- **Run tests (pytest)** — _high_ (0.8)
  - ```sh
    pytest
    ```
  - _why:_ pytest configuration found

## Deploy plan
- targets: generic-host
- readiness: **not-ready**

