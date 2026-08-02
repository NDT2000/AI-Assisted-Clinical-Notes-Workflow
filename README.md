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
