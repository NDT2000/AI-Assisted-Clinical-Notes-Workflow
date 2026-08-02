import {
  Link,
  useParams,
} from "react-router-dom";

import {
  useCurrentActor,
} from "../../../auth/CurrentActorContext";
import {
  NoteDetailWorkspace,
} from "../components/note-detail/NoteDetailWorkspace";
import "../components/css/NoteDetailPage.css";
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

      <NoteDetailWorkspace
        key={`${detail.note.id}:${actor.id}`}
        detail={detail}
        actor={actor}
      />
    </main>
  );
}
