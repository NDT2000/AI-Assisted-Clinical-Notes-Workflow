# AI-Assisted-Clinical-Notes-Workflow

## Project Overview

Clinical Notes Workflow is an application developed to manage AI-generated clinical notes created from clinician-patient sessions. Each note moves through different workflow stages, such as Generating, Ready for Review, In Review, Approved, Rejected, Amended, or Locked.
The application is used by clinicians, reviewers, administrators, and read-only auditors. Reviewers can examine and refine the generated SOAP note, while the workflow determines whether the note can be approved, rejected, returned for correction, or amended.
Correctness is especially important because these notes may eventually become part of the patient’s medical record. They contain information about the patient’s reported symptoms, observed findings, clinical assessment, and treatment plan. The application must therefore prevent edits from being lost, avoid invalid workflow actions, and clearly show whether changes have been saved.

The project also handles difficult situations such as temporary network loss, multiple edits made before an autosave completes, and two users saving changes based on the same earlier version. Offline changes are queued and replayed after reconnection, autosave removes the need to save manually after every edit, and version conflicts are surfaced through a resolution interface instead of silently overwriting another user’s work.

## Key Capabilities

- **Cursor-paginated and virtualized notes list** — Notes are loaded in smaller pages using cursors, while only the rows currently visible on the screen are rendered. This keeps the interface responsive even when the dataset contains thousands of notes.
- **URL-persisted filters, sorting, and search** — Status, reviewer, patient, date, search, and sorting options are stored in the URL. This allows the same view to survive refreshes, browser navigation, and shared links.
- **Structured SOAP editor** — Clinical note content is divided into Subjective, Objective, Assessment, and Plan sections. Each section is independently tracked for unsaved changes.
- **Debounced and coalesced autosave** — The application waits briefly after the user stops typing before saving. Multiple quick edits are combined into one request, and only one save request is allowed to be active for a note at a time.
- **Immutable version history** — Every successful save creates a new note version instead of modifying an earlier version. This preserves the complete history of the clinical note.
- **Word-level version comparison** — Users can compare any two saved versions and see which words were added or removed in each SOAP section.
- **Three-way conflict resolution** — When another user saves a newer version, the application compares the user’s local draft, the latest server version, and their common ancestor. Conflicting sections can then be resolved without losing either user’s work.
- **Optimistic workflow transitions with rollback** — Workflow actions are shown immediately in the interface while the request is processed. If the server rejects the action, the previous state is restored and the rejection reason is displayed.
- **Offline reads and persistent write queue** — Recently opened notes remain available while offline. Saves are stored in IndexedDB and replayed in order when the connection returns, even after a page reload.
- **Real-time status, version, and presence updates** — The application receives live updates when another user changes a note’s status, creates a version, or opens the same note.
- **Role- and ownership-based authorization** — Available actions depend on the user’s role, the note’s current status, and reviewer ownership. The mock server validates the same permissions so client-side controls cannot bypass the rules.
- **Resilient telemetry with PII redaction** — Telemetry events are batched, retried, and stored temporarily after repeated failures. Patient information and clinical free text are removed before any telemetry data is transmitted.
- **Keyboard and screen-reader accessibility** — Filters, actions, editors, conflict resolution, and version comparison support keyboard navigation, visible focus, accessible labels, and live announcements for important status changes.

## Technology Stack

- **React** for the user interface.
- **TypeScript** for domain modelling and compile-time safety.
- **Vite** for local development and production builds.
- **React Router** for routing and URL-persisted filters.
- **TanStack Virtual** for efficiently rendering large note lists.
- **MSW** for the mock REST backend.
- **IndexedDB** for offline caching, queued mutations, and telemetry persistence.
- **Vitest and React Testing Library** for unit and integration testing.

## Getting Started

### Prerequisites

- A current LTS version of Node.js
- npm

### Installation

```bash
cd frontend
npm install
```

### Start the application

```bash
npm run dev
```

The application is normally available at:

```text
http://localhost:5173
```

The mock backend starts automatically through MSW. No external backend or environment variables are required.

### Run the test suite

```bash
npm test -- --run
```

### Create a production build

```bash
npm run build
```

## Domain Model

The application is based on three main domain concepts.

### Note

A `Note` is the workflow container. It stores the current status, assigned reviewer, patient and session references, and the ID of the current version.

### NoteVersion

A `NoteVersion` is an immutable snapshot of the SOAP content. Every successful save creates a new version instead of modifying an existing one. The `parentVersionId` connects versions and supports history, comparisons, conflict detection, and amendment branches.

### ReviewEvent

A `ReviewEvent` is an append-only record of a workflow transition. The review timeline is derived from these events.

The `Note` stores the current workflow state, `NoteVersion` stores clinical content history, and `ReviewEvent` stores workflow history.

## Architecture Overview

The project is divided into the following layers:

```text
React components
        ↓
Feature hooks and coordinators
        ↓
Domain models, guards, and pure logic
        ↓
API, offline, real-time, and telemetry adapters
        ↓
MSW handlers and the authoritative mock store
```

The domain layer contains the state machine, authorization rules, version graph logic, diffing, and conflict resolution. It does not depend on React.

The feature layer contains the notes list, detail workspace, autosave, offline replay, real-time subscriptions, and related hooks.

The mock-server layer validates mutations again and acts as the authoritative backend.

## State Topology

State is kept close to the layer that owns it.

- **URL state:** filters, search, date range, reviewer, patient, and sorting.
- **Server state:** note summaries, note details, workflow status, versions, and review events.
- **Local UI state:** SOAP draft, dirty sections, rejection reason, selected version, and conflict choices.
- **Persistent client state:** offline cache, queued saves, replay state, real-time cursor, and parked telemetry batches.
- **Derived state:** edit permission, available workflow actions, dirty status, and disabled reasons.

URL state is not duplicated in a global store because the URL is already the source of truth for shareable list state.

## Note Lifecycle and State Machine

The note lifecycle is modelled as a first-class state machine.

```text
GENERATING
  ├── READY_FOR_REVIEW
  └── FAILED

FAILED
  └── GENERATING

READY_FOR_REVIEW
  └── IN_REVIEW

IN_REVIEW
  ├── READY_FOR_REVIEW
  ├── APPROVED
  └── REJECTED

REJECTED
  └── READY_FOR_REVIEW

APPROVED
  ├── AMENDED
  └── LOCKED

AMENDED
  └── IN_REVIEW
```

Each transition defines its source state, trigger, next state, role requirements, ownership requirements, and additional guards such as MFA or rejection reason.

The UI derives available actions from the state machine. The mock server runs the same validation again before accepting a transition.

The main source files are:

```text
src/domain/noteTransitions.ts
src/domain/noteGuards.ts
```

## Optimistic Updates

Workflow transitions are applied optimistically to keep the interface responsive.

```text
Snapshot current state
        ↓
Apply the expected transition
        ↓
Send the request
        ↓
Success: reconcile with the server
Failure: restore the snapshot and show the reason
```

Duplicate actions are blocked while a request is pending. The server remains authoritative, and rejected transitions are rolled back cleanly.

## Autosave

The editor uses debounced and coalesced autosave.

The autosave coordinator guarantees that:

- Rapid edits are combined into one save.
- Only one save request is active at a time.
- Edits made during an active request create one trailing save.
- The trailing save contains the latest complete draft.
- Retries reuse the same `clientMutationId`.
- Every save includes `baseVersionId`.
- A save is not shown as complete when newer edits still exist.
- Timers and requests are cleaned up when the note changes or the component unmounts.

## Concurrency and Conflict Resolution

Every save includes the version that the user edited from through `baseVersionId`.

If the server head has changed, the save is rejected with a version conflict instead of overwriting the newer version.

The conflict resolver compares:

- The common ancestor.
- The local unsaved draft.
- The current server version.

Sections changed by only one side are resolved automatically. When both sides change the same section differently, the user can keep the local version, use the server version, or merge the content manually.

## Offline Operation and Resumability

Recently opened note details are cached and remain available while offline.

Saves made while offline are stored in an IndexedDB mutation queue. The queue survives a full page reload.

When the connection returns, mutations are replayed one at a time in FIFO order.

```text
Reconnect
   ↓
Read queued mutations
   ↓
Replay in sequence order
   ↓
Success: remove from queue
Failure: retry with backoff
Conflict: pause and open the conflict resolver
```

The application displays clear states such as Offline, Changes queued, Reconnecting, Conflict requires attention, and All changes saved.

## Real-Time Updates

The mock real-time channel emits:

- Status changes.
- New versions.
- Presence changes.

The application subscribes only to visible list rows and the currently open detail note. Subscriptions are removed when rows leave the viewport or components unmount.

The client handles duplicate, dropped, and out-of-order events through event ID deduplication, cursor replay, idempotent reconciliation, and exponential reconnect backoff with jitter.

Real-time events are reconciled with local optimistic state instead of being applied blindly.

## Telemetry and Privacy

Components use a central telemetry abstraction:

```ts
track(name, properties, {
  important?: boolean,
});
```

Telemetry events are flushed when:

- The batch reaches a size threshold.
- A time threshold expires.
- The route changes.
- The tab becomes hidden.
- The page unloads.

Failed batches retry with backoff. After repeated failures, they are stored in IndexedDB and retried later.

Unload delivery uses `sendBeacon` or a keepalive fetch.

A PII redaction pass runs before every send. SOAP content, patient information, and clinical free text are not allowed in telemetry.

## Authorization Model

The supported roles are:

- `CLINICIAN`
- `REVIEWER`
- `ADMIN`
- `READONLY_AUDITOR`

Permissions depend on the user role, note status, and reviewer ownership.

Examples include:

- Only the assigned reviewer can edit an `IN_REVIEW` note.
- Clinicians can correct rejected or amended notes.
- Auditors are read-only.
- Locked notes cannot be edited.
- Reviewer assignment and regeneration are restricted.

Client-side checks control the user experience, but the mock server validates every mutation independently because the client is treated as potentially hostile.

## Performance and Scale

The notes list is designed for datasets containing 100,000 or more notes.

Cursor pagination loads one result page at a time. Filtering, sorting, and search are performed by the mock server.

TanStack Virtual renders only the rows currently visible in the scroll area, plus a small overscan buffer. A large dataset therefore does not create a large number of DOM elements.

Additional protections include:

- Debounced server-side search.
- Cancellation of stale requests.
- Stable secondary sorting.
- Scoped real-time subscriptions.
- Cleanup of timers and listeners.
- Diff calculation only when comparison is requested.

## Accessibility

The application was designed toward WCAG 2.2 AA, although no formal third-party accessibility audit was performed.

Accessibility support includes:

- Keyboard-accessible actions and filters.
- Arrow-key navigation for patient suggestions.
- Visible focus indicators.
- Accessible labels for editor fields and checkboxes.
- Live regions for saves, connectivity, presence, and errors.
- Disabled action reasons associated with their buttons.
- Focus management for conflict resolution and version comparison.
- Semantic added and removed text in version diffs.
- Reduced-motion support.
- Clear read-only explanations.

## Testing Strategy

### Unit Tests

Unit tests cover:

- State-machine guards.
- Authorization rules.
- Transition eligibility.
- Version graph traversal.
- Word-level diffing.
- Three-way conflict resolution.
- Telemetry redaction.
- URL parameter parsing.

### Integration Tests

Integration tests cover:

- Autosave debounce and trailing saves.
- Save idempotency.
- Optimistic transition rollback.
- Offline queue persistence and replay.
- Replay conflict handling.
- Real-time deduplication and reconnection.
- Server-side authorization.
- Telemetry batching and lifecycle flushing.
- Accessibility behavior.

The repository does not include a full Playwright or Cypress suite. Critical user journeys are covered through React Testing Library and MSW-backed integration tests.

The main risks tested were lost edits, duplicate writes, stale responses, invalid transitions, unauthorized mutations, replay ordering, duplicate real-time events, and clinical data leaking into telemetry.

## Assumptions

- Authentication is simulated through mock actor headers.
- One current demo actor is used at a time.
- The backend is simulated in the browser through MSW.
- IndexedDB is available in the browser.
- Recently opened notes are cached rather than the full dataset.
- The real-time channel is a mock implementation.
- MFA is represented by a boolean rather than a real authentication flow.
- All generated patient and note data is synthetic.

## Trade-offs and Known Limitations

### MSW Backend

MSW keeps the project easy to run locally and allows realistic server validation. It does not represent a shared production backend across independent devices.

### Mock Authentication

Actor headers make role and ownership scenarios testable, but production authentication would require trusted server-side session validation.

### Three-Way Merge Instead of a CRDT

Three-way merge directly supports the immutable version model without adding the complexity of real-time collaborative editing.

### IndexedDB Persistence

IndexedDB provides durable offline behavior. A production implementation would also require schema migrations and cross-tab coordination.

### No Browser-Driven End-to-End Suite

The project prioritizes deterministic domain and integration tests. A production extension would add Playwright coverage for the main review, offline recovery, and conflict-resolution flows.

### Main-Thread Version Diffing

Word-level comparison is sufficient for the current note size. Very large documents could move diff calculation to a Web Worker.

## Repository Structure

```text
src/
├── auth/             Mock actor and identity
├── domain/           Models, state machine, guards, and pure logic
├── features/notes/   List, detail, autosave, offline, and real-time features
├── mock-data/        Deterministic generated data
├── mock-server/      MSW handlers and authoritative mock store
├── telemetry/        Batching, redaction, retry, and persistence
└── test/             Shared test configuration and helpers
```
