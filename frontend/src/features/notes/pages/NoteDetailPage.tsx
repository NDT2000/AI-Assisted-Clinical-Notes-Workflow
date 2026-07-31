import { Link, useParams, } from "react-router-dom";

import type { UserRole, } from "../../../domain/noteAttributes";
import { useNoteDetail, } from "../hooks/useNoteDetail";
import { NoteDetailWorkspace } from "../components/note-detail/NoteDetailWorkspace";
import type { SaveNoteVersionActor } from "../../../domain/noteSave";
import "../components/css/NoteDetailPage.css";

const CURRENT_ACTOR:
  SaveNoteVersionActor = {
    id: "reviewer-1",
    displayName: "Current Reviewer",
    role: "REVIEWER",
  };

export function NoteDetailPage() {
  const { noteId } = useParams<{
    noteId: string;
  }>();

  const {
    state,
    retry,
  } = useNoteDetail(
    noteId,
    CURRENT_ACTOR.role,
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
    <main className="note-detail-page">
      <Link
        className="note-detail-back-line"
        to="/notes">
        Back to notes
      </Link>

      <NoteDetailWorkspace
        key={detail.note.id}
        detail={detail}
        actor={CURRENT_ACTOR} 
      />
    </main>
  );
}