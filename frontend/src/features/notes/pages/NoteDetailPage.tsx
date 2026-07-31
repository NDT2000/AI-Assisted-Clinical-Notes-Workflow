import { Link, useParams, } from "react-router-dom";

import type { UserRole, } from "../../../domain/noteAttributes";
import { useNoteDetail, } from "../hooks/useNoteDetail";

const CURRENT_ACTOR_ROLE: UserRole =
  "REVIEWER";

export function NoteDetailPage() {
  const { noteId } = useParams<{
    noteId: string;
  }>();

  const {
    state,
    retry,
  } = useNoteDetail(
    noteId,
    CURRENT_ACTOR_ROLE,
  );

  if (state.status === "loading") {
    return (
      <main aria-busy="true">
        <Link to="/notes">
          Back to notes
        </Link>

        <h1>Note detail</h1>

        <p
          role="status"
          aria-live="polite"
        >
          Loading note details...
        </p>
      </main>
    );
  }

  if (
    state.status === "unauthorized"
  ) {
    return (
      <main>
        <Link to="/notes">
          Back to notes
        </Link>

        <h1>Access denied</h1>

        <p role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  if (state.status === "not-found") {
    return (
      <main>
        <Link to="/notes">
          Back to notes
        </Link>

        <h1>Note not found</h1>

        <p role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main>
        <Link to="/notes">
          Back to notes
        </Link>

        <h1>Unable to load note</h1>

        <p role="alert">
          {state.message}
        </p>

        <button
          type="button"
          onClick={retry}
        >
          Try again
        </button>
      </main>
    );
  }

  const detail = state.note;

  return (
    <main>
      <Link to="/notes">
        Back to notes
      </Link>

      <header>
        <h1>
          {detail.patient.displayName}
        </h1>

        <p>
          Note ID: {detail.note.id}
        </p>
      </header>

      <section
        aria-labelledby="workflow-heading"
      >
        <h2 id="workflow-heading">
          Workflow
        </h2>

        <dl>
          <div>
            <dt>Status</dt>
            <dd>
              {detail.note.status}
            </dd>
          </div>

          <div>
            <dt>Assigned reviewer</dt>
            <dd>
              {detail.assignedReviewer
                ?.displayName ??
                "Unassigned"}
            </dd>
          </div>

          <div>
            <dt>Current revision</dt>
            <dd>
              {
                detail.currentVersion
                  .revisionNumber
              }
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="patient-heading"
      >
        <h2 id="patient-heading">
          Patient
        </h2>

        <dl>
          <div>
            <dt>Name</dt>
            <dd>
              {
                detail.patient
                  .displayName
              }
            </dd>
          </div>

          <div>
            <dt>
              Medical record number
            </dt>
            <dd>
              {
                detail.patient
                  .medicalRecordNumber
              }
            </dd>
          </div>

          <div>
            <dt>Date of birth</dt>
            <dd>
              {
                detail.patient
                  .dateOfBirth
              }
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="session-heading"
      >
        <h2 id="session-heading">
          Session
        </h2>

        <dl>
          <div>
            <dt>Clinician</dt>
            <dd>
              {
                detail.session
                  .clinician
                  .displayName
              }
            </dd>
          </div>

          <div>
            <dt>Started</dt>
            <dd>
              {new Date(
                detail.session.startedAt,
              ).toLocaleString()}
            </dd>
          </div>

          <div>
            <dt>Ended</dt>
            <dd>
              {new Date(
                detail.session.endedAt,
              ).toLocaleString()}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-labelledby="content-heading"
      >
        <h2 id="content-heading">
          Current note
        </h2>

        <p>
          Revision{" "}
          {
            detail.currentVersion
              .revisionNumber
          } loaded successfully.
        </p>
      </section>
    </main>
  );
}