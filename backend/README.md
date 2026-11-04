# Clinical Notes Workflow — Backend API

FastAPI service for the Clinical Notes Workflow, backed by PostgreSQL with
pgvector.

## Requirements

- [uv](https://docs.astral.sh/uv/) (installs Python 3.13 and the dependencies)
- Docker, for the local database

## Setup

From the repository root:

```bash
cp .env.example .env
docker compose up -d postgres
```

Then, from `backend/`:

```bash
uv sync
uv run clinical-notes-api
```

The API runs at <http://127.0.0.1:8000>; interactive docs are at `/docs`.
Check it with `GET /api/health`.

## Configuration

Settings are read from environment variables, then from the repository-root
`.env` shared with Docker Compose. See `.env.example` for every variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `development`, `test` or `production` |
| `DATABASE_URL` | local Compose database | SQLAlchemy URL for Postgres |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Browser origins allowed to call the API |

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```
