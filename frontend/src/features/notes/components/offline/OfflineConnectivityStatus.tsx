import {
  Link,
} from "react-router-dom";

import {
  type OfflineSaveReplaySnapshot,
} from "../../offline/offlineSaveReplay";
import {
  type OfflineSaveReplayStore,
  useOfflineSaveReplaySnapshot,
} from "../../offline/useOfflineSaveReplaySnapshot";

import "./OfflineConnectivityStatus.css";

export interface OfflineConnectivityStatusProps {
  store?: OfflineSaveReplayStore;
}

interface ConnectivityPresentation {
  message: string;
  showConflictLink: boolean;
}

function formatQueuedChanges(
  pendingCount: number,
): string {
  return pendingCount === 1
    ? "1 change"
    : `${pendingCount} changes`;
}

export function getConnectivityPresentation(
  snapshot:
    OfflineSaveReplaySnapshot,
): ConnectivityPresentation {
  if (!snapshot.isHydrated) {
    if (snapshot.pendingCount > 0) {
      return {
        message:
          snapshot.status ===
          "offline"
            ? "Offline — changes queued"
            : "Changes queued — checking sync status",
        showConflictLink: false,
      };
    }

    return {
      message:
        snapshot.status ===
        "offline"
          ? "Offline — checking queued changes"
          : "Checking saved changes",
      showConflictLink: false,
    };
  }

  if (
    snapshot.status ===
      "blocked-conflict" &&
    snapshot.blockedConflict !== null
  ) {
    return {
      message:
        "Conflict requires attention — queued changes are paused",
      showConflictLink: true,
    };
  }

  if (
    snapshot.status ===
    "resolving-conflict"
  ) {
    return {
      message:
        "Reconnecting — saving resolved changes",
      showConflictLink: false,
    };
  }

  if (
    snapshot.status === "retrying"
  ) {
    return {
      message:
        "Reconnecting — retrying queued changes",
      showConflictLink: false,
    };
  }

  if (
    snapshot.status === "replaying"
  ) {
    return {
      message:
        snapshot.pendingCount > 0
          ? `Reconnecting — saving ${formatQueuedChanges(
              snapshot.pendingCount,
            )}`
          : "Reconnecting",
      showConflictLink: false,
    };
  }

  if (
    snapshot.status === "offline"
  ) {
    return {
      message:
        snapshot.pendingCount > 0
          ? `Offline — ${formatQueuedChanges(
              snapshot.pendingCount,
            )} queued`
          : "Offline",
      showConflictLink: false,
    };
  }

  if (
    snapshot.status ===
    "paused-error"
  ) {
    return {
      message:
        snapshot.pendingCount > 0
          ? "Changes queued — automatic replay paused"
          : "Sync paused",
      showConflictLink: false,
    };
  }

  if (snapshot.pendingCount > 0) {
    return {
      message: `${formatQueuedChanges(
        snapshot.pendingCount,
      )} queued`,
      showConflictLink: false,
    };
  }

  return {
    message: "All changes saved",
    showConflictLink: false,
  };
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
