# PST Report — /home/z/my-project/pst/fixtures/python-app

- Scanned at: `2026-06-17T04:39:56.285Z`
- Overall confidence: **high** (0.88)

## Languages
- **Python** (requires >=3.10) — _high_ (0.95)
  - evidence: pyproject.toml, requirements.txt

## Frameworks
- **FastAPI** — _high_ (0.8)
  - evidence: dep:fastapi

## Package managers
- **pip** (binary: `pip`) — _high_ (0.8)

## Manifests
- `pyproject.toml` (pyproject.toml)
- `requirements.txt` (requirements.txt)

## Environment
- `.env.example` (example)
  - `DATABASE_URL`=`sqlite:///./app.db` _(required)_
  - `SECRET_KEY`=`change-me` _(required)_
- `README.md` (template)
  - `DATABASE_URL`=`sqlite:///./app.db`
  - `SECRET_KEY`=`change-me`

## Entrypoints
- `python_app.main:main`
- `main.py`

## Install plan
- **Install dependencies (pip)** — _high_ (0.85)
  - ```sh
    pip install -r requirements.txt
    ```
  - _why:_ requirements.txt present
- _note: Consider migrating to uv or Poetry for reproducible installs._

## Run plan
- **Run FastAPI app** — _medium_ (0.55)
  - ```sh
    uvicorn main:app --reload
    ```
  - _why:_ FastAPI dependency detected; assumed uvicorn entrypoint main:app

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
- targets: fly, railway, render
- readiness: **not-ready**

