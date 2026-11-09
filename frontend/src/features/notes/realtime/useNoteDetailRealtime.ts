import type {
  SoapContent,
} from "../../../domain/noteAttributes";
import type {
  NoteDetail,
} from "../../../domain/noteDetail";
import type {
  AutosaveStatus,
} from "../autosave/AutosaveCoordinator";
import type {
  NoteRealtimeEvent,
} from "./realtimeTypes";
import {
  useRealtimeSubscription,
} from "./useRealtimeSubscription";

interface UseNoteDetailRealtimeOptions {
  noteId: string;
  /* The latest committed detail, read when an event arrives. */
  getDetail: () => NoteDetail;
  /* Reconciles an event into the workspace's detail. */
  applyEvent: (
    event: NoteRealtimeEvent,
  ) => void;
  autosaveStatus: AutosaveStatus;
  hasDirtySections: boolean;
  /*
   * Moves autosave onto a version saved elsewhere; returns false
   * when local work prevents it.
   */
  adoptServerVersion: (
    versionId: string,
    content: SoapContent,
  ) => boolean;
  onServerContentAdopted: (
    content: SoapContent,
  ) => void;
  onNotice: (message: string) => void;
  /* A change made while this page was disconnected (shown as missed). */
  onMissed?: (
    event: NoteRealtimeEvent,
  ) => void;
  /* Too much changed while disconnected: the note must be reloaded. */
  onReloadRequired?: () => void;
}

const STATUS_CHANGED_ELSEWHERE =
  "This note changed in another session. The latest server status has been applied.";

const VERSION_ARRIVED_DURING_EDITS =
  "A newer version arrived while local edits were pending. Saving will use the normal conflict-resolution flow.";

function isOwnOptimisticEcho(
  detail: NoteDetail,
  event: Extract<
    NoteRealtimeEvent,
    { type: "note.status_changed" }
  >,
): boolean {
  const { fromStatus, toStatus } =
    event.response.timelineEvent;

  return detail.timeline.some(
    timelineEvent =>
      timelineEvent.eventId.startsWith(
        "optimistic-transition",
      ) &&
      timelineEvent.fromStatus ===
        fromStatus &&
      timelineEvent.toStatus === toStatus,
  );
}

/*
 * Live updates for the open note. Status changes and new versions
 * are reconciled into the detail; a new version replaces the editor
 * content only when there is no local work it could overwrite.
 */
export function useNoteDetailRealtime({
  noteId,
  getDetail,
  applyEvent,
  autosaveStatus,
  hasDirtySections,
  adoptServerVersion,
  onServerContentAdopted,
  onNotice,
  onMissed,
  onReloadRequired,
}: UseNoteDetailRealtimeOptions): void {
  useRealtimeSubscription({
    noteIds: [noteId],

    onReset: () => {
      onReloadRequired?.();
    },

    onEvent: (event, meta) => {
      if (
        meta.missed &&
        event.type !== "note.presence_changed"
      ) {
        onMissed?.(event);
      }

      if (
        event.type === "note.status_changed"
      ) {
        if (
          !isOwnOptimisticEcho(
            getDetail(),
            event,
          )
        ) {
          onNotice(
            STATUS_CHANGED_ELSEWHERE,
          );
        }

        applyEvent(event);
        return;
      }

      if (
        event.type === "note.version_added"
      ) {
        const hasUnacknowledgedLocalWork =
          autosaveStatus !== "idle" ||
          hasDirtySections;

        if (
          autosaveStatus !== "saving" &&
          hasUnacknowledgedLocalWork
        ) {
          onNotice(
            VERSION_ARRIVED_DURING_EDITS,
          );
        }

        applyEvent(event);

        if (!hasUnacknowledgedLocalWork) {
          const { savedVersion } =
            event.response;

          const content: SoapContent = {
            ...savedVersion.content,
          };

          if (
            adoptServerVersion(
              savedVersion.versionId,
              content,
            )
          ) {
            onServerContentAdopted(content);
          }
        }

        return;
      }

      applyEvent(event);
    },
  });
}
