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
| Frontend (React) | Complete; runs against the API, with sign-in and set-password pages |
| Backend (FastAPI) | Database, seed data, accounts and sessions, user management, note endpoints, full-text search and a live WebSocket feed in place |
| Database (Postgres + pgvector), Redis | Run locally with Docker Compose |
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
- **Real-time updates** — other people's saves and status changes appear on
  the visible notes without a reload; after a lost connection, a "While you
  were away" panel lists what was missed and points out where it meets your
  offline edits.
- **Role- and ownership-based authorization** — checked in the UI and again on
  the server.
- **Real accounts** — users sign in with their own password; an administrator
  adds people, changes roles, deactivates accounts and resets passwords from
  the Users page.
- **Resilient, privacy-safe telemetry** — batched and retried, with patient
  information and clinical text removed before sending.
- **Keyboard and screen-reader accessibility** throughout.

## Technology stack

**Frontend:** React, TypeScript, Vite, React Router, TanStack Virtual,
IndexedDB (`idb`), Vitest and React Testing Library, with MSW as the mock
backend in tests.

**Backend:** Python 3.13, FastAPI, SQLAlchemy 2, Alembic, psycopg 3,
pydantic-settings, WebSockets and the Redis client; managed with uv, linted
with ruff, tested with pytest.

**Data and infrastructure:** PostgreSQL 16 with pgvector, Redis 7 (relays live
events between API processes), Docker Compose.

## Repository structure

```text
.
├── frontend/                React application
│   └── src/
│       ├── api/             API base URL and the authenticated fetch
│       ├── app/             Header and sign-out
│       ├── auth/            Session, sign-in and set-password pages, page guard
│       ├── domain/          Models, workflow rules and pure logic
│       ├── features/notes/  List, detail, autosave, offline and real-time
│       ├── features/users/  Users admin pages and the reviewer directory
│       ├── generated/       API types generated from contract/openapi.json
│       ├── mock-data/       Deterministic synthetic data and users, for tests
│       ├── mock-server/     MSW handlers for tests, mock store and mock tokens
│       ├── shared/          Shared display formatters
│       ├── telemetry/       Batching, redaction, retry and persistence
│       └── test/            Test setup
├── backend/                 FastAPI service
│   ├── src/clinical_notes_api/
│   │   ├── config.py        Settings from environment variables
│   │   ├── main.py          App factory and routes
│   │   ├── auth.py          Login and the signed-in user
│   │   ├── accounts/        Accounts, user admin, setup links, sessions, create-admin
│   │   ├── security.py      Password hashing and access tokens
│   │   ├── dependencies.py  Database session and current-user dependencies
│   │   ├── errors.py        Error responses ({"error", "message"})
│   │   ├── workflow.py      Workflow rules, read from the contract
│   │   ├── notes/           Note and patient endpoints, and the note event log
│   │   ├── realtime/        The live WebSocket connection and its Redis relay
│   │   ├── telemetry.py     Telemetry intake, with a clinical-content check
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

### Backend and database

From the repository root:

```bash
cp .env.example .env
docker compose up -d postgres redis
```

The database listens on host port **5433** and Redis on **6380**, so they do
not clash with a locally installed Postgres (5432) or Redis (6379).

Then, from `backend/`:

```bash
uv sync
uv run alembic upgrade head      # create the tables
uv run clinical-notes-seed       # load 5,000 synthetic notes and the users
uv run clinical-notes-api        # start the API
```

The API runs at <http://127.0.0.1:8000>, with interactive docs at `/docs` and
a health check at `GET /api/health`.

The seed creates one administrator (`admin-1`) and nine test users
(`clinician-1` to `clinician-3`, `reviewer-1` to `reviewer-5`, `auditor-1`),
each with their own random password. It writes the usernames and passwords to
`credentials.local.md` at the repository root. That file is git-ignored: never
commit or share it. Seeding again replaces every password.

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"username": "admin-1", "password": "<from credentials.local.md>"}'

# A new access token from the renewal cookie, then sign out.
curl -X POST http://127.0.0.1:8000/api/auth/refresh -b cookies.txt -c cookies.txt
curl -X POST http://127.0.0.1:8000/api/auth/logout -b cookies.txt
```

For a real installation, create the first administrator yourself; there is no
default admin password anywhere:

```bash
uv run clinical-notes-create-admin   # asks for a username, name and password
uv run clinical-notes-prune-events  # remove note events older than 30 days
```

### Frontend

The frontend needs the API (above). With the database and API running, from
`frontend/`:

```bash
npm install
npm run dev
```

Open <http://localhost:5173> and sign in with a username and password from
`credentials.local.md`. The Vite dev server forwards `/api` to the API on port
8000 (see `frontend/vite.config.ts`), so the page and the API share one address
and the sign-in cookie reaches the API. Changes are saved in Postgres; run the
seed with `--reset` to start over.

A new user opens the setup link an administrator gives them
(`/set-password#...`), chooses a password and then signs in.

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
uv run pytest --cov      # with a coverage report; fails below 95%
```

Database tests need the Compose Postgres and are skipped without it; set
`REQUIRE_DATABASE=1` to make them fail instead.

**Continuous integration.** GitHub Actions
(`.github/workflows/backend.yml`) runs the backend checks on every pull
request and push to `main` that touches `backend/` or `contract/`: lint,
formatting, and the full test suite with coverage against a Postgres
service container, with `REQUIRE_DATABASE=1` so no database test is quietly
skipped.

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
| `ACCESS_TOKEN_MINUTES` | `15` | How long an access token stays valid |
| `SESSION_HOURS` | `12` | How long a sign-in lasts, however often it is renewed |
| `LOGIN_FAILURE_LIMIT` | `5` | Failed sign-ins per username before it is locked |
| `LOGIN_IP_FAILURE_LIMIT` | `20` | Failed sign-ins per address before it is locked |
| `LOGIN_LOCKOUT_MINUTES` | `15` | The window failures are counted in, and how long a lock lasts |
| `APP_BASE_URL` | `http://localhost:5173` | Where people open the application; setup links point here |
| `SETUP_LINK_HOURS` | `72` | How long a setup link stays valid |
| `EVENT_RETENTION_DAYS` | `30` | How long the note event log keeps events for catching up |
| `REDIS_URL` | unset | Redis that relays live events between API processes (`redis://localhost:6380/0` with Compose); unset, events reach only the same process |
| `REDIS_PORT` | `6380` | Host port for Redis |

Environment variables take precedence over `.env`.

The frontend reads one Vite variable:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | empty (same origin) | Where the API is; leave it empty so the sign-in cookie works (the dev server forwards `/api`) |

The mock server (MSW) answers only in tests; the app itself always uses the
API.

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
Backend: FastAPI API (the MSW mock server in tests)
```

- The **domain** layer holds the state machine, authorization rules, version
  graph, diffing and conflict resolution.
- The **feature** layer holds the notes list, detail workspace, autosave,
  offline replay and real-time subscriptions.
- The **backend** is authoritative: it validates every mutation again, because
  the client is treated as untrusted.
- Every request goes through one function (`api/apiClient.ts`) that adds the
  API's address and the signed-in user's access token, and renews a rejected
  token once. In tests, the token is a local stand-in that carries the user,
  so the mock server sees users the way the API does.

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

Status changes and new versions come from the server's live connection
(`/api/realtime`, see "Live connection"), for the visible list rows and the
open note only; following updates on the same connection when rows scroll
away or another note opens. Duplicate, dropped and out-of-order events are
handled with event-id deduplication, cursor replay, idempotent
reconciliation and reconnect backoff with jitter. Events are reconciled with
local optimistic state, not applied blindly.

- **Signed in on the connection.** The access token is the first message, and
  a renewed one is sent on the same connection before the old one expires.
- **No history replay on a fresh page.** The server says where its event log
  is when the connection opens; notes the page has just loaded are followed
  from there.
- **Late events never win.** An event older than what the page shows (by the
  note's server time) is ignored, so a late or replayed event cannot take the
  screen back to an older version or status. While the user's own action is
  still pending, the page carries the browser's clock, so that check waits.
- **"While you were away."** After a dropped connection, the events that
  arrive while catching up are listed on the note page (who, what, when). If
  someone else saved while the user's offline edit was waiting, the panel
  says whether it overlaps that edit (and in which sections) or not, with a
  button to the conflict resolver; if the note was approved or locked
  meanwhile, it says why the offline edit cannot be saved. When too much
  changed to catch up, the note is reloaded and the page says so.
- Presence ("who is viewing") still comes from the tabs of one browser,
  until the server takes it over.

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

### Endpoints

The API offers the same routes, request bodies, responses and error codes as
the frontend's mock server (`frontend/src/mock-server`), so the frontend can
switch to it without changing its data handling. Every route needs a signed-in
user. Interactive documentation is at `/docs`.

| Route | Purpose |
| --- | --- |
| `GET /api/notes` | One page of notes: filters (`status`, `reviewerId`, `patientId`, `createdFrom`, `createdTo`), full-text search (`q`), sorting (`sortBy`, `sortOrder`), `limit` (up to 100) and `cursor` |
| `GET /api/notes/{noteId}` | A note with its patient, session, reviewer, versions and review history |
| `POST /api/notes/{noteId}/versions` | Save edited content as a new version |
| `POST /api/notes/{noteId}/transitions` | Run a workflow action (start review, approve, reject, …) |
| `POST /api/notes/bulk/assign-reviewer` | Assign or remove a reviewer on several notes |
| `POST /api/notes/bulk/regenerate` | Send failed notes back to generation |
| `GET /api/patients` | Up to 20 patients, by name, who have notes matching the filters |
| `POST /api/telemetry` | Usage events; refused if they carry clinical or patient data |

Signing in and managing accounts have their own routes, described under
"Accounts" and "Authentication" below.

How changes stay safe:

- **Workflow rules** come from the shared contract, so a refusal carries the
  same reason the UI shows (`403 forbidden` for editing, `422
  transition_not_allowed` for actions).
- **Stale edits are caught.** Each save and action names the version it
  started from (`baseVersionId`). If the note has moved on, the answer is
  `409 version_conflict` with the current version and, for saves, the last
  version both sides share, which the frontend uses for a three-way merge.
- **Retries are safe.** Each save and action carries a `clientMutationId`. The
  answer is stored, so a retry returns the first answer instead of changing the
  note twice; reusing the id for a different request is refused with `409
  idempotency_conflict`.
- **One change at a time per note.** Changing a note locks its row first, so
  two requests for the same note run one after the other.
- **History is complete.** Every action, including bulk regeneration, adds a
  review event.
- **Pagination is keyset-based**: the cursor holds the last row's sort value
  and id, so pages never overlap or skip notes while data changes.
- Malformed requests get `400 invalid_request` with the problem named.

### Search

The notes list's `q` uses Postgres full-text search. Each note has a
`search_vector` holding the patient's name and the current version's SOAP
text, indexed with GIN, so searching stays fast as the number of notes grows.

- Every word typed must match the start of a word, in the name or the note
  text: `aver` finds "Avery", and `avery adherence` finds Avery's notes that
  mention adherence.
- Note text is stemmed in English, so `improving` also finds "improvement";
  names are matched as written.
- Only letters and digits count; a search with no words lists every note.
- A database trigger rebuilds the vector whenever a note gets a new current
  version, so saves, the seed and any other write keep it current.
- Results keep the chosen sort order; they are not ranked by relevance.

### Event log

Every saved version and every workflow action (including bulk regeneration)
adds a row to `note_events`, for real-time clients: the note, the kind of
change (`note.version_added` or `note.status_changed`, with the action), the
time, and the API's own response to the change, which the frontend already
knows how to apply. Reviewer assignments are not recorded yet.

- **Written in the same transaction as the change**, so a change never goes
  out without its event, nor an event without its change. Refused requests
  and retried requests (which get their stored answer) add nothing.
- **Numbered in commit order.** Each event gets the next number while
  holding a lock that is released when its transaction commits, so a later
  number can never become visible before an earlier one. A client that has
  seen event N catches up with exactly "everything after N" for the notes it
  follows (`events_after`, in pages), over the live connection below.
- **Kept for 30 days.** `clinical-notes-prune-events` removes older events
  and remembers the highest number it removed. A client that last saw an
  event before that, or a number the log has not reached (as after a
  database reset), is told to reload its notes instead of catching up.
- Events contain note text, like the notes themselves, and are only sent to
  signed-in users.

### Live connection

`/api/realtime` is a WebSocket that pushes note changes as they happen. The
messages are small JSON objects:

| From | Message | Meaning |
| --- | --- | --- |
| Browser | `{"type": "auth", "token": ...}` | The access token: first, within 5 seconds, and again whenever it is renewed |
| Browser | `{"type": "subscribe", "noteIds": [...], "afterCursor": N}` | Follow these notes (up to 200), having seen every event up to N |
| Server | `{"type": "ready", "latestCursor": N}` | Signed in; the event log is at N |
| Server | `{"type": "event", "event": ...}` | One note change, in the event log's shape |
| Server | `{"type": "caughtUp", "cursor": N}` | Missed events have been sent; what follows is live |
| Server | `resetRequired` | Too much has changed (or the log was reset): reload these notes |
| Server | `error` | A broken message, with the reason; the connection stays open |
| Server | `ping` | Every 25 seconds, so idle connections are not dropped |

- **The token is never in the URL**, so it stays out of logs and history. A
  connection whose token expires without being renewed is closed with code
  4401 (renew and reconnect); a deactivated account gets 4403.
- **Other sites cannot connect.** Browsers do not limit WebSockets to the
  page's own site, so the server checks the `Origin` itself (the
  `CORS_ORIGINS` list) and refuses others before the connection opens.
- **Nothing is missed or repeated in the hand-over.** After `subscribe`, the
  server sends the missed events from the event log; changes that arrive
  meanwhile wait, and those not already sent follow in order.
- **Events go out only after their change commits.** The API process that
  made the change publishes it to a Redis channel, and every API process
  passes it to its own connections that follow that note. Without
  `REDIS_URL`, an in-process relay is used. If Redis is down, changes are
  still saved, and clients get them when they next catch up.
- A client that cannot keep up (1,000 messages waiting) is disconnected and
  catches up when it reconnects.

### Seed data

`clinical-notes-seed` loads the same 5,000 synthetic notes as the frontend's
mock server, so a note id means the same note in both. Use `--reset` to replace
existing data and `--count` to change the number of notes; it refuses to run
when `ENVIRONMENT=production`. Every user gets a random password, written to
`credentials.local.md` (`--credentials-file` to choose another place) before
the data is committed, so if the file cannot be written nothing is seeded. The generator is a Python port of
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

### Signing in (frontend)

- **Every page except sign-in and set-password needs a signed-in user.**
  Anyone else is sent to `/sign-in` and comes back to the page they asked for
  afterwards. Opening the app again resumes the session from the renewal
  cookie, so a reload does not ask for the password.
- **The access token lives in memory only** (`auth/session.ts`). It is renewed
  shortly before it expires, and once more if the API refuses it. When the
  session ends (12 hours, deactivation, a copied cookie), the app returns to
  sign-in and says why.
- **Tabs take turns renewing** (Web Locks), because each renewal cookie works
  once and two tabs using the same one at the same moment would end the
  session. Signing in or out in one tab is passed to the others
  (BroadcastChannel).
- **Signing out** ends the session on the server and clears this browser's
  offline notes and queued saves (it may be a shared computer). If saves are
  still waiting to be sent, the header asks first.
- **Offline data belongs to one user.** When a different user signs in on the
  same browser, what the previous one left is cleared before anything reads
  it, and a queued save is never sent with someone else's sign-in.
- **Reviewer lists** in the filters, bulk actions and assignment panel come
  from `GET /api/users/directory`, so new reviewers appear and deactivated
  ones disappear. A deactivated reviewer still assigned to a note stays shown
  on that note until it is reassigned.

### Users page (administrators)

Administrators see a **Users** link in the header; everyone else does not, and
opening `/admin/users` directly takes them to the notes (the API refuses them
too).

- **The list** shows every account with its role, status (Active, Waiting for
  password, Deactivated) and last sign-in, filtered by name or username, role
  and status.
- **Add user** asks for the full name, username and role, then shows the
  setup link once, with a Copy button and its expiry, to pass on privately.
- **One person's page** edits the name, username and role, deactivates or
  reactivates the account, issues a new setup link (or a password reset for
  someone who has a password), and lists the account's history in plain
  sentences.
- **The server's rules show where they apply:** an administrator cannot
  change their own role or deactivate themselves, and deactivating a reviewer
  with open reviews asks for a second confirmation with the number of notes.
- Changes to people refresh the reviewer lists on the notes pages.

### Accounts

Each user has a username to sign in with (lowercase letters, digits, dots,
dashes or underscores, 3 to 32 characters) and an internal id; seeded users'
usernames are their ids. Users are deactivated, never deleted, because notes
and their history refer to them. Every change to an account is written to an
append-only admin action log that a database trigger protects, like note
history.

An administrator manages accounts from the Users page (see "Users page"
above), which uses these routes. Everything under `/api/users` is for
administrators only, except the directory:

| Route | Purpose |
| --- | --- |
| `GET /api/users` | Every account, including deactivated ones; filters `role`, `active`, `q` (name or username) |
| `POST /api/users` | Create an account of any role, without a password, and its setup link |
| `GET /api/users/{id}` | One account, its open reviews and its admin action log |
| `PATCH /api/users/{id}` | Change the name, username or role |
| `POST /api/users/{id}/deactivate`, `/reactivate` | Turn an account off (ending its sessions) or back on |
| `POST /api/users/{id}/setup-link` | A new setup link; for someone with a password it is a reset |
| `GET /api/users/directory` | Active people with name and role (`?role=REVIEWER`), for any signed-in user |
| `POST /api/auth/setup-link` | Whose setup link this is, for the set-password page |
| `POST /api/auth/set-password` | Choose a password with a setup link |

- **Setup links** are shown once, in the response that creates them, and look
  like `http://localhost:5173/set-password#<token>`: the part after `#` is
  never sent to a server, so it stays out of access logs. Only a hash is
  stored. A link expires after 72 hours, works once, and stops working when a
  newer one is issued or the account is deactivated. Using it signs the
  person out everywhere; until then, an old password keeps working.
- **No one can lock the administrators out.** An administrator cannot
  deactivate themselves or change their own role, and the last active
  administrator who can sign in cannot be removed. Changes to administrators
  lock them first, so two administrators removing each other at the same
  moment cannot both succeed.
- **Deactivating a reviewer with open reviews** (notes ready for or in review
  assigned to them) is refused with `409 has_open_reviews` and the count,
  until the request confirms it with `{"confirmOpenReviews": true}`. The notes
  stay assigned until someone reassigns them; deactivated reviewers cannot be
  assigned new ones.
- Errors: `409 username_taken`, `own_account`, `last_admin`,
  `has_open_reviews`, `account_deactivated`; `400 invalid_setup_link`.

### Authentication

| Route | Purpose |
| --- | --- |
| `POST /api/auth/login` | Sign in with a username and password: an access token, plus a renewal cookie |
| `POST /api/auth/refresh` | Swap the renewal cookie for a new access token and a new cookie |
| `POST /api/auth/logout` | End the session and remove the cookie |
| `GET /api/auth/me` | The signed-in user |

The access token (JWT, HS256) is short-lived, 15 minutes by default; clients
send it as `Authorization: Bearer <token>` and the page keeps it in memory
only. To stay signed in, the page calls `/api/auth/refresh`, which uses the
renewal cookie.

- **The renewal cookie** cannot be read by JavaScript (`HttpOnly`), is sent
  only to `/api/auth` and only from the application's own pages
  (`SameSite=Strict`), and needs HTTPS in production (`Secure`). As a second
  check, these routes refuse requests whose `Origin` is another site.
- **Each renewal cookie works once.** Renewing replaces it, and the session
  still ends 12 hours after signing in. A cookie presented a second time has
  been copied, so the whole session ends, for the copier and the real user
  alike. Only SHA-256 hashes of the cookies are stored, and two renewals with
  the same cookie at once cannot both succeed.
- **Signing out** revokes the session on the server, and works even when the
  access token has expired.
- **Password guessing is slowed down.** After 5 failed sign-ins for a username
  within 15 minutes, or 20 from one address, further attempts get `429
  too_many_attempts` (with `Retry-After`) until the oldest of those failures
  is 15 minutes old, even with the right password. A successful sign-in clears
  the username's failures. Failures are kept in the database, so restarting
  the API does not reset them.
- **Usernames cannot be probed.** Passwords are stored as Argon2 hashes. A
  wrong password, an unknown user and an account still waiting for its setup
  link get the same answer and take the same time. Only someone who gives the
  right password learns that an account is deactivated (`403
  account_deactivated`).
- On every request the user is read again from the database: deactivating or
  removing a user revokes access at once, and the role always comes from the
  database, never from the token.
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
deduplication and reconnection, server-side authorization, telemetry batching,
sign-in token caching and renewal, and accessibility behavior.

**Backend** (pytest) — settings and the health endpoint; parity between the
Python seed generator and the TypeScript one; every workflow decision in the
shared contract; and, against a throwaway `clinical_notes_test` database, that
migrations match the models and round-trip, constraints and immutability
triggers hold, seeded rows match the generator, accounts follow their rules
(username format and uniqueness, an unchangeable admin action log, a
migration that gives existing users their id as username, every seeded
password signing in, the create-admin command's checks), and login, token expiry,
forged tokens and revoked users behave correctly. Sessions are tested the
same way: signing in by username, deactivated users, the cookie's settings,
each cookie working once, reuse ending the session, simultaneous renewals,
the session's end time, signing out, both lockouts and requests from other
sites. User management is tested for every role: only administrators manage
accounts; creating, listing, filtering, renaming and role changes, each
logged once; setup links working once, expiring, being replaced, resetting a
password and ending sessions; the self-protection rules; the confirmation for
reviewers with open reviews; the directory; and, with real commits, that two
administrators removing each other at once leave one administrator. The note
endpoints are
checked the same way: list items and note details equal the mock server's for
every seeded note; cursor pages cover every note exactly once for each sort;
filters match the mock; pages stay consistent while notes change; search
matches name prefixes and stemmed note text, needs every word, follows newly
saved versions and uses the GIN index; saves, actions, conflicts, retries,
bulk actions, patient lookup and the telemetry check behave as specified.

- **Authorization matrix** (`test_note_rules.py`): for every status, every
  kind of user (clinician, admin, auditor, the assigned reviewer with and
  without MFA, another reviewer) and every action, saving, transitions and
  bulk actions give exactly the answer the shared rules give for that note's
  stored state.
- **Concurrency** (`test_concurrency.py`): with real commits on separate
  connections, of eight simultaneous saves from one version exactly one
  wins and the rest get a conflict; eight simultaneous retries make one
  change; only one of five reviewers can start a review; overlapping bulk
  actions do not deadlock; two administrators removing each other at once
  leave one administrator; a second writer to the event log waits for the
  first to commit before taking a number. Without the locks these tests
  fail.
- **Event log** (`test_note_events.py`): saves, actions and bulk
  regeneration each record exactly one event with the API's response;
  refused and retried requests record none; catching up returns the right
  events in order and in pages; pruning, and when a client must reload.
- **Live connection** (`test_realtime.py`): signing in on the connection
  (missing, bad, expired, renewed and other-user tokens, deactivated users,
  other sites); catching up, then live events for followed notes only, with
  no gap or repeat in the hand-over; broken messages; keep-alive; slow
  clients; events published only after commit; and the Redis relay between
  two processes (CI runs Redis; locally that test is skipped without it).
- **Frontend real-time**: the WebSocket channel (token first, renewal on
  the same connection, re-subscribing, reporting drops), the manager
  (following new notes from the log position, marking missed events until
  caught up, reload requests), ignoring late events, and the "While you were
  away" panel's wording for overlapping, non-overlapping and refused edits.
- **Seed command**: refuses to run in production and to seed a non-empty
  database without `--reset`.

Backend tests are grouped by feature, one file each: `test_auth.py` (sign-in
and sessions), `test_users.py` (user management), `test_notes.py`,
`test_note_rules.py`, `test_concurrency.py`, and so on. A new test goes into
its feature's file; a new file is only for a new feature area or a different
database setup (rolled back per test, or committing for real).

Coverage is about 98% of lines and branches; CI fails below 95%. Database
tests are skipped when Postgres is not running, unless `REQUIRE_DATABASE=1`.

The main risks tested are lost edits, duplicate writes, stale responses,
invalid transitions, unauthorized mutations, replay ordering, duplicate
real-time events and clinical data leaking into telemetry. There is no
browser-driven end-to-end suite yet.

## Assumptions and limitations

- **Presence is shared only between tabs of one browser** for now; the
  server takes it over next. Live note changes come from the server.
- **The note list does not reload by itself** when the server says too much
  changed while it was disconnected; the open note does. Reloading the list
  page catches it up.
- **An offline edit is sent again only on its next save attempt.** After a
  reconnection the panel shows what was missed straight away, but whether it
  overlaps the offline edit appears once that edit is retried (automatically
  when the browser comes back online, or with "Try again").
- **The app needs the API to run**; the mock server is used only in tests.
- **An access token stays valid until it expires** (15 minutes) after signing
  out; the session itself, and with it any renewal, ends at once. Deactivating
  a user ends their access at once.
- **Lockouts can be triggered on purpose**: someone who knows a username can
  lock it for 15 minutes by guessing wrong. That is the usual price of
  limiting guesses.
- **The administrator passes setup links on by hand**; the application does
  not send email.
- **Search covers the whole note**, not only the preview the mock server
  searched, so a word in the synthetic notes' shared wording (such as
  "symptoms") matches every note. A renamed patient's notes are re-indexed
  only when they next change.
- **Presence is always empty** in the API until real-time updates arrive, and
  accepted telemetry is only logged, not stored.
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
