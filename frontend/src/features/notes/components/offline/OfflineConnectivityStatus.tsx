import {
  Link,
} from "react-router-dom";

import {
  getConnectivityPresentation,
} from "./connectivityPresentation";
import {
  type OfflineSaveReplayStore,
  useOfflineSaveReplaySnapshot,
} from "../../offline/useOfflineSaveReplaySnapshot";

import "./OfflineConnectivityStatus.css";

export interface OfflineConnectivityStatusProps {
  store?: OfflineSaveReplayStore;
}

export function OfflineConnectivityStatus({
  store,
}: OfflineConnectivityStatusProps) {
  const snapshot =
    useOfflineSaveReplaySnapshot(
      store,
    );

  const presentation =
    getConnectivityPresentation(
      snapshot,
    );

  const blockedNoteId =
    snapshot.blockedConflict
      ?.noteId ?? null;

  const requiresAttention =
    snapshot.status ===
      "blocked-conflict" ||
    snapshot.status ===
      "paused-error";

  return (
    <div
      className="offline-connectivity-status"
      data-sync-status={
        snapshot.status
      }
      role={
        requiresAttention
          ? "alert"
          : "status"
      }
      aria-label="Connectivity status"
      aria-live={
        requiresAttention
          ? "assertive"
          : "polite"
      }
      aria-atomic="true"
      aria-relevant="text"
    >
      <span>
        {presentation.message}
      </span>

      {presentation.showConflictLink &&
        blockedNoteId !== null && (
          <Link
            className="offline-connectivity-status__action"
            to={`/notes/${encodeURIComponent(
              blockedNoteId,
            )}`}
          >
            Open note to resolve
          </Link>
        )}
    </div>
  );
}
