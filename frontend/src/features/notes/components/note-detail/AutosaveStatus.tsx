import type {
  AutosaveSnapshot,
} from "../../autosave/AutosaveCoordinator";

interface AutosaveStatusProps {
  snapshot: AutosaveSnapshot;
  onRetry: () => void;
}

function getAutosaveStatusMessage(
  snapshot: AutosaveSnapshot,
): string {
  switch (snapshot.status) {
    case "idle":
      return "All changes saved";
    case "changes-pending":
      return "Unsaved changes";
    case "saving":
      return "Saving changes";
    case "queued":
      return "Offline — changes queued";
    case "save-failed":
      return "Save failed";
    case "conflict":
      return "Conflict requires attention";
  }
}

export function AutosaveStatus({
  snapshot,
  onRetry,
}: AutosaveStatusProps) {
  const className = [
    "note-autosave-status",
    `note-autosave-status--${snapshot.status}`,
  ].join(" ");

  if (
    snapshot.status ===
    "save-failed"
  ) {
    return (
      <div
        className={className}
        role="alert"
        aria-label="Autosave status"
      >
        <span>Save failed.</span>

        <button
          type="button"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    );
  }

  if (
    snapshot.status ===
    "conflict"
  ) {
    return (
      <p
        className={className}
        role="alert"
        aria-label="Autosave status"
      >
        Conflict requires attention.
        This note was updated
        elsewhere.
      </p>
    );
  }

  return (
    <p
      className={className}
      role="status"
      aria-label="Autosave status"
      aria-live="polite"
      aria-atomic="true"
    >
      {
        getAutosaveStatusMessage(
          snapshot,
        )
      }
    </p>
  );
}
