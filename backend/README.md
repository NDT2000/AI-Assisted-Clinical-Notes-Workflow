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

The database listens on host port **5433**, so it does not clash with a
locally installed Postgres on 5432.

Then, from `backend/`:

```bash
uv sync
uv run alembic upgrade head      # create the tables
uv run clinical-notes-seed       # load 5,000 synthetic notes
uv run clinical-notes-api        # start the API
```

The API runs at <http://127.0.0.1:8000>; interactive docs are at `/docs`.
Check it with `GET /api/health`.

## Database

| Table | Holds |
| --- | --- |
| `users` | Clinicians, reviewers, admins and auditors |
| `patients` | Synthetic patients |
| `sessions` | The clinician-patient encounter each note documents |
| `notes` | Workflow state: status, assigned reviewer, current version |
| `note_versions` | Immutable snapshots of the SOAP content |
| `review_events` | Append-only history of workflow transitions |

`note_versions` and `review_events` are history: a database trigger rejects
any `UPDATE` or `DELETE` on them.

### Migrations

Models live in `src/clinical_notes_api/db/models.py`; migrations in
`migrations/versions/`. After changing a model:

```bash
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

Review each generated migration before committing it.

### Seed data

`clinical-notes-seed` loads the same synthetic notes as the frontend's mock
server, so ids such as `note-002614` refer to the same note in both. Use
`--reset` to replace existing data and `--count` to change the number of
notes. It refuses to run when `ENVIRONMENT=production`.

The generator is a port of `frontend/src/mock-data`. `tests/test_mock_data.py`
compares it with a sample exported from the TypeScript code; regenerate the
sample with `tests/fixtures/export_mock_sample.ts` after changing either one.

## Configuration

Settings are read from environment variables, then from the repository-root
`.env` shared with Docker Compose. See `.env.example` for every variable.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `development`, `test` or `production` |
| `DATABASE_URL` | local Compose database on port 5433 | SQLAlchemy URL for Postgres |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Browser origins allowed to call the API |

## Checks

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

Database tests create and drop a separate `clinical_notes_test` database. They
are skipped when Postgres is not running.
