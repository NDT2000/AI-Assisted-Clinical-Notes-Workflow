import {
  useEffect,
  useRef,
} from "react";
import {
  useBlocker,
} from "react-router-dom";

import type {
  UnresolvedSave,
} from "../../hooks/useNoteAutosave";

interface LeaveNoteGuardProps {
  unresolvedSave: UnresolvedSave | null;
}

const LEAVE_MESSAGES: Record<
  UnresolvedSave,
  string
> = {
  "kept-offline":
    "Your latest edits are not saved yet. If you leave, they are kept in this browser and you will be asked to resolve them when you reopen this note.",
  "will-be-lost":
    "The server rejected your latest edits. If you leave now, those edits will be lost.",
};

/*
 * Asks for confirmation before navigating away from a note whose
 * last save failed or conflicted. Pending and in-flight saves need
 * no prompt: the autosave coordinator finishes them after unmount.
 */
export function LeaveNoteGuard({
  unresolvedSave,
}: LeaveNoteGuardProps) {
  const blocker = useBlocker(
    ({
      currentLocation,
      nextLocation,
    }) =>
      unresolvedSave !== null &&
      currentLocation.pathname !==
        nextLocation.pathname,
  );

  const stayButtonRef =
    useRef<HTMLButtonElement | null>(
      null,
    );

  const isBlocked =
    blocker.state === "blocked";

  useEffect(() => {
    if (isBlocked) {
      stayButtonRef.current?.focus();
    }
  }, [isBlocked]);

  if (
    !isBlocked ||
    unresolvedSave === null
  ) {
    return null;
  }

  return (
    <div
      className="leave-note-guard"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-note-guard-title"
      aria-describedby="leave-note-guard-message"
    >
      <h2 id="leave-note-guard-title">
        Leave this note?
      </h2>

      <p id="leave-note-guard-message">
        {LEAVE_MESSAGES[unresolvedSave]}
      </p>

      <div className="leave-note-guard__actions">
        <button
          ref={stayButtonRef}
          type="button"
          onClick={() => blocker.reset?.()}
        >
          Stay on this note
        </button>

        <button
          type="button"
          onClick={() => blocker.proceed?.()}
        >
          Leave anyway
        </button>
      </div>
    </div>
  );
}
