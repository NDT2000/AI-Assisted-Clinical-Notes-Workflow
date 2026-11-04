# AI-Assisted Clinical Notes Workflow

A review workflow for AI-generated clinical notes. Clinicians, reviewers,
administrators and auditors move each SOAP note through a controlled
lifecycle — from generation to review, approval, amendment and lock — without
losing edits, overwriting each other's work, or taking actions the workflow
does not allow.

All patient and note data in this repository is synthetic.

## Project status

| Part | State |
| --- | --- |
| Frontend (React) | Complete; runs against an in-browser mock backend (MSW) |
| Backend (FastAPI) | Database, seed data and login (JWT) in place; note endpoints in progress |
| Database (Postgres + pgvector) | Runs locally with Docker Compose |
| AI note generation (RAG) | Planned |

## Contents

- [Overview](#overview)
- [Key capabilities](#key-capabilities)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Domain model](#domain-model)
- [Note lifecycle and state machine](#note-lifecycle-and-state-machine)
- [Frontend design](#frontend-design)
- [Backend design](#backend-design)
- [Authorization model](#authorization-model)
- [Performance and scale](#performance-and-scale)
- [Accessibility](#accessibility)
- [Testing](#testing)
- [Assumptions and limitations](#assumptions-and-limitations)
- [License](#license)

## Overview

Each note moves through workflow stages such as Generating, Ready for Review,
In Review, Approved, Rejected, Amended and Locked. Reviewers examine and refine
the generated SOAP note (Subjective, Objective, Assessment, Plan), and the
workflow decides whether it can be approved, rejected, returned for correction
or amended.

Correctness matters because these notes may become part of a patient's
medical record. The application therefore prevents edits from being lost,
blocks invalid workflow actions, and always shows whether changes are saved.

It also handles the hard cases: temporary network loss, several edits made
before an autosave completes, and two users saving changes based on the same
earlier version. Offline changes are queued and replayed after reconnection,
and version conflicts open a resolution screen instead of silently overwriting
another user's work.

## Key capabilities

- **Cursor-paginated, virtualized notes list** — notes load a page at a time,
  and only the rows on screen are rendered, so thousands of notes stay fast.
- **URL-persisted filters, sorting and search** — status, reviewer, patient,
  dates, search and sort live in the URL, so a view survives refreshes,
  navigation and shared links.
- **Structured SOAP editor** — each of the four sections tracks its own unsaved
  changes.
- **Debounced, coalesced autosave** — quick edits are combined into one save,
  only one save per note runs at a time, and pending edits are saved when the
  editor closes.
- **Immutable version history** — every save creates a new version; earlier
  versions are never modified (enforced by the database).
- **Word-level version comparison** — compare any two versions section by
  section.
- **Three-way conflict resolution** — local draft, latest server version and
  their common ancestor are compared; non-overlapping changes merge
  automatically.
- **Optimistic workflow transitions with rollback** — actions show
  immediately and are rolled back, with the reason, if the server rejects them.
- **Offline reads and a persistent write queue** — recently opened notes stay
  readable offline; saves are queued in IndexedDB and replayed in order after
  reconnecting, even across reloads.
- **Real-time updates** — live status changes, new versions and presence for
  the visible notes.
- **Role- and ownership-based authorization** — checked in the UI and again on
  the server.
- **Resilient, privacy-safe telemetry** — batched and retried, with patient
  information and clinical text removed before sending.
- **Keyboard and screen-reader accessibility** throughout.

## Technology stack

**Frontend:** React, TypeScript, Vite, React Router, TanStack Virtual,
IndexedDB (`idb`), MSW for the mock backend, Vitest and React Testing Library.

**Backend:** Python 3.13, FastAPI, SQLAlchemy 2, Alembic, psycopg 3,
pydantic-settings; managed with uv, linted with ruff, tested with pytest.

**Data and infrastructure:** PostgreSQL 16 with pgvector, Docker Compose.

## Repository structure

```text
.
├── frontend/                React application
│   └── src/
│       ├── auth/            Demo identities and the current-actor context
│       ├── domain/          Models, workflow rules and pure logic
│       ├── features/notes/  List, detail, autosave, offline and real-time
│       ├── generated/       API types generated from contract/openapi.json
│       ├── mock-data/       Deterministic synthetic data
│       ├── mock-server/     MSW handlers and the authoritative mock store
│       ├── shared/          Shared display formatters
│       ├── telemetry/       Batching, redaction, retry and persistence
│       └── test/            Test setup
├── backend/                 FastAPI service
│   ├── src/clinical_notes_api/
│   │   ├── config.py        Settings from environment variables
│   │   ├── main.py          App factory and routes
│   │   ├── auth.py          Login and the signed-in user
│   │   ├── security.py      Password hashing and access tokens
│   │   ├── dependencies.py  Database session and current-user dependencies
│   │   ├── errors.py        Error responses ({"error", "message"})
│   │   ├── workflow.py      Workflow rules, read from the contract
│   │   ├── openapi.py       Writes contract/openapi.json
│   │   ├── db/              SQLAlchemy models and sessions
│   │   └── seed/            Synthetic data generator and loader
│   ├── migrations/          Alembic migrations
│   ├── db/init/             SQL run when the database is first created
│   └── tests/               pytest suite
├── contract/                Shared by frontend and backend
│   ├── note-workflow.json        The workflow rules and their messages
│   ├── note-workflow.cases.json  Expected decisions both sides are tested on
│   └── openapi.json              The API description
├── docker-compose.yml       Local Postgres + pgvector
└── .env.example             Every configuration variable, documented
```

Tests sit in a `tests/` folder beside the code they cover.

## Getting started

### Prerequisites

- Node.js (current LTS) and npm — for the frontend
- [uv](https://docs.astral.sh/uv/) — for the backend; it installs Python 3.13
- Docker — for the database

### Frontend only (no setup beyond npm)

The frontend runs on its own: its mock backend starts in the browser.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Switch between demo users (clinician, reviewers,
admin, auditor) from the bar at the top to see how permissions change.

### Backend and database

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

The API runs at <http://127.0.0.1:8000>, with interactive docs at `/docs` and
a health check at `GET /api/health`.

Every seeded user signs in with the password in `DEMO_USER_PASSWORD`
(`demo-password` by default) and their id as the username — `clinician-1`,
`reviewer-1` to `reviewer-5`, `admin-1` or `auditor-1`:

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "reviewer-1", "password": "demo-password"}'
```

### Checks

Frontend, from `frontend/`:

```bash
npm run lint
npm test -- --run
npm run build
```

Backend, from `backend/`:

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

## Configuration

The backend and Docker Compose read the same `.env` file at the repository
root. `.env.example` lists every variable; `.env` is git-ignored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `clinical`, `clinical`, `clinical_notes` | Database created by Compose |
| `POSTGRES_PORT` | `5433` | Host port for the database |
| `ENVIRONMENT` | `development` | `development`, `test` or `production` |
| `DATABASE_URL` | the Compose database | SQLAlchemy URL the API connects to |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Browser origins allowed to call the API |
| `JWT_SECRET` | a development-only value | Signs access tokens; required in production, 32+ characters |
| `ACCESS_TOKEN_MINUTES` | `60` | How long an access token stays valid |
| `DEMO_USER_PASSWORD` | `demo-password` | Password the seed gives every demo user |

Environment variables take precedence over `.env`. The frontend needs no
configuration yet.

## Architecture

The frontend is layered so that business rules never depend on React:

```text
React components
        ↓
Feature hooks and coordinators
        ↓
Domain models, guards and pure logic
        ↓
API, offline, real-time and telemetry adapters
        ↓
Backend: MSW mock server today, FastAPI next
```

- The **domain** layer holds the state machine, authorization rules, version
  graph, diffing and conflict resolution.
- The **feature** layer holds the notes list, detail workspace, autosave,
  offline replay and real-time subscriptions.
- The **backend** is authoritative: it validates every mutation again, because
  the client is treated as untrusted.

State is kept close to the layer that owns it:

- **URL:** filters, search, dates, reviewer, patient and sort.
- **Server:** note summaries and details, status, versions and review events.
- **Local UI:** the SOAP draft, dirty sections, rejection reason, selected
  version and conflict choices.
- **Persistent client:** offline cache, queued saves, replay state, real-time
  cursor and parked telemetry.
- **Derived:** edit permission, available actions, dirty status and disabled
  reasons.

## Domain model

| Concept | Purpose | Table |
| --- | --- | --- |
| **Note** | The workflow container: status, assigned reviewer, patient and session, and the current version | `notes` |
| **NoteVersion** | An immutable snapshot of the SOAP content; `parentVersionId` links versions for history, comparison, conflicts and amendments | `note_versions` |
| **ReviewEvent** | An append-only record of one workflow transition; the review timeline is built from these | `review_events` |
| **User** | A clinician, reviewer, administrator or auditor | `users` |
| **Patient** | A synthetic patient | `patients` |
| **Session** | The clinician–patient encounter a note documents | `sessions` |

The note holds the current workflow state, versions hold the content history,
and review events hold the workflow history.

## Note lifecycle and state machine

| From | Action | To | Who may do it |
| --- | --- | --- | --- |
| `GENERATING` | Generation completes | `READY_FOR_REVIEW` | System |
| `GENERATING` | Generation fails | `FAILED` | System |
| `FAILED` | Regenerate | `GENERATING` | Clinician, admin |
| `READY_FOR_REVIEW` | Start review | `IN_REVIEW` | A reviewer, if unassigned or assigned to them |
| `IN_REVIEW` | Return to queue | `READY_FOR_REVIEW` | The assigned reviewer |
| `IN_REVIEW` | Approve | `APPROVED` | The assigned reviewer, after MFA |
| `IN_REVIEW` | Reject | `REJECTED` | The assigned reviewer, with a reason |
| `REJECTED` | Resubmit | `READY_FOR_REVIEW` | Clinician, with all four SOAP sections filled |
| `APPROVED` | Amend | `AMENDED` | Clinician, admin; within 24 h of approval |
| `APPROVED`, `AMENDED` | Grace period expires | `LOCKED` | System |
| `AMENDED` | Start review | `IN_REVIEW` | A reviewer, if unassigned or assigned to them |

`LOCKED` is final.

### One definition, shared by frontend and backend

The rules above — and who may edit content or assign reviewers, with every
message the user sees — are defined once, in `contract/note-workflow.json`.
The frontend (`frontend/src/domain/noteGuards.ts`) and the backend
(`backend/src/clinical_notes_api/workflow.py`) both implement them from that
file.

`contract/note-workflow.cases.json` records the expected decision for 7,680
combinations of status, action, role, reviewer ownership, MFA, rejection
reason, content and time since approval, plus the editing, assignment and
regeneration rules. Both test suites check every case, so the UI and the server
cannot drift apart. After an intended rule change, regenerate the cases from
the repository root and review the diff:

```bash
npx --prefix frontend vite-node contract/export-workflow-cases.ts
```

### Typed API

The backend describes its API in `contract/openapi.json`, and the frontend's
types in `frontend/src/generated/api-schema.ts` are generated from it. After
changing a route or response model:

```bash
cd backend && uv run clinical-notes-openapi
cd ../frontend && npm run api:types
```

Tests on both sides fail if either file is out of date.

## Frontend design

### Optimistic updates

```text
Snapshot the current state → apply the expected transition → send the request
    success: reconcile with the server's response
    failure: restore the snapshot and show the reason
```

Duplicate actions are blocked while a request is pending.

### Autosave

The autosave coordinator guarantees that:

- rapid edits are combined into one save, and only one save is active at a time;
- edits made during a save produce one trailing save with the latest draft;
- retries reuse the same `clientMutationId`, and every save sends its
  `baseVersionId`;
- a save is not shown as complete while newer edits exist;
- closing the editor saves pending edits instead of dropping them, and closing
  the tab with unsaved work shows a warning.

### Concurrency and conflict resolution

Every save says which version it was based on (`baseVersionId`). If the
server's latest version has moved on, the save is rejected as a conflict
instead of overwriting it. The resolver then compares the common ancestor, the
local draft and the server version: sections changed on only one side merge
automatically; for sections both sides changed, the user keeps theirs, takes
the server's, or merges by hand.

### Offline operation

Recently opened notes are cached and readable offline. Offline saves go into an
IndexedDB queue that survives reloads and is replayed in order after
reconnecting:

```text
Reconnect → read the queue → replay in order
    success: remove from the queue
    failure: retry with backoff
    conflict: pause and open the conflict resolver
```

The UI shows clear states: Offline, Changes queued, Reconnecting, Conflict
requires attention, All changes saved.

### Real-time updates

Status changes, new versions and presence are pushed for the visible list rows
and the open note only; subscriptions end when rows scroll away or components
unmount. Duplicate, dropped and out-of-order events are handled with event-id
deduplication, cursor replay, idempotent reconciliation and reconnect backoff
with jitter. Events are reconciled with local optimistic state, not applied
blindly.

### Telemetry and privacy

Components call one function:

```ts
track(name, properties, { important?: boolean });
```

Events are batched and flushed on size, on a timer, on route changes, when the
tab is hidden and on unload (via `sendBeacon` or a keepalive request). Failed
batches retry with backoff and are parked in IndexedDB after repeated failures.
A redaction pass runs before every send: SOAP content, patient information and
clinical free text never leave the browser.

## Backend design

### Database

Postgres tables mirror the frontend's domain types and keep the same string ids
(for example `note-002614`), so URLs and payloads do not change when the
frontend moves from the mock server to the API. Statuses and roles are checked
by constraints, revision numbers are unique per note, and only revision 1 may
have no parent. A trigger rejects any `UPDATE` or `DELETE` on `note_versions`
and `review_events`: history cannot be rewritten.

### Migrations

Models live in `backend/src/clinical_notes_api/db/models.py` and migrations in
`backend/migrations/versions/`. After changing a model:

```bash
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

Review every generated migration before committing it.

### Seed data

`clinical-notes-seed` loads the same 5,000 synthetic notes as the frontend's
mock server, so a note id means the same note in both. Use `--reset` to replace
existing data and `--count` to change the number of notes; it refuses to run
when `ENVIRONMENT=production`. The generator is a Python port of
`frontend/src/mock-data`; a test compares it with a sample exported from the
TypeScript code (`backend/tests/fixtures/export_mock_sample.ts`).

## Authorization model

Roles: `CLINICIAN`, `REVIEWER`, `ADMIN`, `READONLY_AUDITOR`. Permissions depend
on the role, the note's status and reviewer ownership. For example:

- only the assigned reviewer can edit an `IN_REVIEW` note;
- clinicians correct rejected and amended notes;
- auditors are read-only, and locked notes cannot be edited;
- reviewer assignment and regeneration are restricted.

Client-side checks shape the experience; the server validates every mutation
independently.

### Authentication

`POST /api/auth/login` exchanges a username and password for a signed access
token (JWT, HS256); clients send it as `Authorization: Bearer <token>`, and
`GET /api/auth/me` returns the signed-in user.

- Passwords are stored as Argon2 hashes. A wrong password and an unknown user
  get the same answer and take the same time, so usernames cannot be probed.
- On every request the user is read again from the database: removing a user
  revokes access at once, and the role always comes from the database, never
  from the token.
- Errors use one shape, `{"error": "...", "message": "..."}`. A `401` means
  "sign in"; a `403` carries the workflow rule's own reason.
- A test checks that every route that changes data requires a signed-in user,
  so a new endpoint cannot ship unprotected by accident.
- The API refuses to start in production with the development `JWT_SECRET` or
  one shorter than 32 characters.

## Performance and scale

The notes list is built for large datasets. Pagination uses cursors and loads
one page at a time; filtering, sorting and search happen on the server.
TanStack Virtual renders only the visible rows plus a small buffer. Other
safeguards: debounced search, cancellation of stale requests, stable secondary
sorting, scoped real-time subscriptions, timer and listener cleanup, and
diffing only when a comparison is requested. The database indexes notes by
status, reviewer, patient and `(sort column, id)` for keyset pagination.

## Accessibility

Designed toward WCAG 2.2 AA (no formal third-party audit has been done):
keyboard-accessible actions and filters, arrow-key navigation for patient
suggestions, visible focus, labelled editor fields and checkboxes, live regions
for saves, connectivity, presence and errors, disabled-action reasons linked to
their buttons, focus management in the conflict resolver and version
comparison, semantic added and removed text in diffs, reduced-motion support,
and clear read-only explanations.

## Testing

**Frontend** (Vitest and React Testing Library) — unit tests for state-machine
guards, authorization, transition eligibility, version-graph traversal,
word-level diffing, three-way merge, telemetry redaction and URL parsing;
integration tests for autosave and trailing saves, save idempotency, optimistic
rollback, offline queue persistence and replay, replay conflicts, real-time
deduplication and reconnection, server-side authorization, telemetry batching
and accessibility behavior.

**Backend** (pytest) — settings and the health endpoint; parity between the
Python seed generator and the TypeScript one; every workflow decision in the
shared contract; and, against a throwaway `clinical_notes_test` database, that
migrations match the models and round-trip, constraints and immutability
triggers hold, seeded rows match the generator, and login, token expiry,
forged tokens and revoked users behave correctly. Database tests are skipped
when Postgres is not running.

The main risks tested are lost edits, duplicate writes, stale responses,
invalid transitions, unauthorized mutations, replay ordering, duplicate
real-time events and clinical data leaking into telemetry. There is no
browser-driven end-to-end suite yet.

## Assumptions and limitations

- **The frontend still uses the mock backend.** It runs against MSW, with
  identities passed as demo actor headers; it moves to the API and its access
  tokens once the note endpoints are ready. MSW does not share data between
  devices.
- **Demo accounts share one password** (`DEMO_USER_PASSWORD`), which suits a
  demonstration with synthetic data, not real users.
- **MFA** is a per-user flag (on for reviewers and the admin), not a real
  second factor.
- **Three-way merge instead of a CRDT** — it fits the immutable version model
  without the complexity of real-time co-editing.
- **IndexedDB** is assumed available; a production build would also need
  client-side schema migrations and cross-tab coordination.
- **Diffing runs on the main thread**, which is enough for notes of this size;
  very large documents could move it to a Web Worker.
- **Only recently opened notes** are cached offline, not the whole dataset.
- **All data is synthetic.**

## License

[MIT](LICENSE)
