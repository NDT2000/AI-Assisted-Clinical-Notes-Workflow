import {
  useState,
} from "react";
import {
  Link,
  useParams,
} from "react-router-dom";

import {
  useCurrentActor,
} from "../../../auth/useCurrentActor";
import {
  LeaveNoteGuard,
} from "../components/note-detail/LeaveNoteGuard";
import {
  NoteDetailWorkspace,
} from "../components/note-detail/NoteDetailWorkspace";
import "./NoteDetailPage.css";
import "./NoteDetailPolish.css";
import type {
  UnresolvedSave,
} from "../hooks/useNoteAutosave";
import {
  useNoteDetail,
} from "../hooks/useNoteDetail";

function formatCachedAt(
  cachedAt: number,
): string {
  return new Date(
    cachedAt,
  ).toLocaleString();
}

export function NoteDetailPage() {
  const { actor } =
    useCurrentActor();

  const { noteId } =
    useParams<{
      noteId: string;
    }>();

  const {
    state,
    retry,
  } = useNoteDetail(
    noteId,
    actor.role,
  );

  const [
    unresolvedSave,
    setUnresolvedSave,
  ] = useState<UnresolvedSave | null>(
    null,
  );

  // Set when the note was reloaded because too much changed while the
  // live connection was away.
  const [
    reloadedAfterAbsence,
    setReloadedAfterAbsence,
  ] = useState(false);

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
    state.status ===
    "unauthorized"
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

  if (
    state.status ===
    "not-found"
  ) {
    return (
      <main>
        <Link to="/notes">
          Back to notes
        </Link>

        <h1>
          Note not found
        </h1>

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

        <h1>
          Unable to load note
        </h1>

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
    <main className="note-detail-page">
      <Link
        className="note-detail-back-line"
        to="/notes"
      >
        Back to notes
      </Link>

      {state.source === "cache" && (
        <section
          className="note-detail-offline-status"
          role="status"
          aria-label="Offline note status"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>
            Offline — showing a
            cached note
          </strong>

          <p>
            This note may not include
            recent changes made by
            other users.
          </p>

          {state.cachedAt !==
            null && (
            <p>
              Cached{" "}
              <time
                dateTime={new Date(
                  state.cachedAt,
                ).toISOString()}
              >
                {formatCachedAt(
                  state.cachedAt,
                )}
              </time>
            </p>
          )}
        </section>
      )}

      <LeaveNoteGuard
        unresolvedSave={unresolvedSave}
      />

      {reloadedAfterAbsence && (
        <section
          className="while-away-panel"
          role="status"
          aria-live="polite"
        >
          <p>
            This note changed while you
            were away; it has been
            reloaded.
          </p>
          <button
            type="button"
            onClick={() =>
              setReloadedAfterAbsence(false)
            }
          >
            Dismiss
          </button>
        </section>
      )}

      <NoteDetailWorkspace
        key={`${detail.note.id}:${actor.id}`}
        detail={detail}
        actor={actor}
        onReloadRequired={() => {
          setReloadedAfterAbsence(true);
          retry();
        }}
        onUnresolvedSaveChange={
          setUnresolvedSave
        }
      />
    </main>
  );
}
