import type {
  NoteStatus,
} from "../../../domain/noteAttributes";
import type {
  NoteDetail,
  ReviewTimelineEvent,
} from "../../../domain/noteDetail";
import type {
  NoteSummary,
} from "../../../domain/noteSummary";
import {
  noteTransitions,
} from "../../../domain/noteTransitions";
import type {
  NoteRealtimeEvent,
  NoteStatusChangedRealtimeEvent,
} from "./realtimeTypes";

function isAllowedServerStatusChange(
  fromStatus: NoteStatus,
  toStatus: NoteStatus,
  trigger:
    NoteStatusChangedRealtimeEvent[
      "trigger"
    ],
): boolean {
  if (fromStatus === toStatus) {
    return true;
  }

  return (
    noteTransitions[fromStatus][
      trigger
    ] === toStatus
  );
}

function getAssignedReviewerFromStatusEvent(
  current:
    NoteDetail["assignedReviewer"],
  event:
    NoteStatusChangedRealtimeEvent,
): NoteDetail["assignedReviewer"] {
  const assignedReviewerId =
    event.response.note
      .assignedReviewerId;

  if (assignedReviewerId === null) {
    return null;
  }

  if (
    current?.id ===
    assignedReviewerId
  ) {
    return current;
  }

  if (
    event.response.timelineEvent
      .actorId ===
    assignedReviewerId
  ) {
    return {
      id: assignedReviewerId,
      displayName:
        event.response.timelineEvent
          .actorDisplayName,
      role:
        event.response.timelineEvent
          .actorRole,
    };
  }

  return current;
}

function removeMatchingOptimisticEvents(
  timeline:
    readonly ReviewTimelineEvent[],
  authoritativeEvent:
    ReviewTimelineEvent,
): ReviewTimelineEvent[] {
  return timeline.filter(
    event =>
      !(
        event.eventId.startsWith(
          "optimistic-transition",
        ) &&
        event.fromStatus ===
          authoritativeEvent.fromStatus &&
        event.toStatus ===
          authoritativeEvent.toStatus
      ),
  );
}

export function applyRealtimeEventToNoteDetail(
  detail: NoteDetail,
  event: NoteRealtimeEvent,
): NoteDetail {
  if (
    event.noteId !== detail.note.id
  ) {
    return detail;
  }

  if (
    event.type ===
    "note.presence_changed"
  ) {
    return {
      ...detail,
      presence:
        event.presence.map(
          entry => ({
            ...entry,
            user: {
              ...entry.user,
            },
          }),
        ),
    };
  }

  if (
    event.type ===
    "note.version_added"
  ) {
    const response =
      event.response;

    const versionExists =
      detail.versions.some(
        version =>
          version.versionId ===
          response.savedVersion
            .versionId,
      );

    return {
      ...detail,
      note: {
        ...response.note,
      },
      currentVersion: {
        ...response.savedVersion,
        content: {
          ...response.savedVersion
            .content,
        },
      },
      versions: versionExists
        ? detail.versions
        : [
            ...detail.versions,
            {
              ...response.savedVersion,
              content: {
                ...response.savedVersion
                  .content,
              },
            },
          ],
    };
  }

  const response = event.response;
  const timelineEvent =
    response.timelineEvent;

  if (
    !isAllowedServerStatusChange(
      timelineEvent.fromStatus,
      timelineEvent.toStatus,
      event.trigger,
    )
  ) {
    return detail;
  }

  const eventAlreadyExists =
    detail.timeline.some(
      existing =>
        existing.eventId ===
        timelineEvent.eventId,
    );

  const withoutOptimistic =
    removeMatchingOptimisticEvents(
      detail.timeline,
      timelineEvent,
    );

  return {
    ...detail,
    note: {
      ...response.note,
    },
    assignedReviewer:
      getAssignedReviewerFromStatusEvent(
        detail.assignedReviewer,
        event,
      ),
    currentVersion: {
      ...response.currentVersion,
      content: {
        ...response.currentVersion
          .content,
      },
    },
    timeline: eventAlreadyExists
      ? withoutOptimistic
      : [
          ...withoutOptimistic,
          {
            ...timelineEvent,
          },
        ],
  };
}

export function applyRealtimeEventToNoteSummary(
  summary: NoteSummary,
  event: NoteRealtimeEvent,
): NoteSummary {
  if (
    event.noteId !== summary.id ||
    event.type ===
      "note.presence_changed"
  ) {
    return summary;
  }

  if (
    event.type ===
    "note.version_added"
  ) {
    const response =
      event.response;

    if (
      summary.currentVersion.id ===
        response.savedVersion
          .versionId &&
      summary.currentVersion
        .revision ===
        response.savedVersion
          .revisionNumber
    ) {
      return summary;
    }

    return {
      ...summary,
      status: response.note.status,
      currentVersion: {
        id:
          response.savedVersion
            .versionId,
        revision:
          response.savedVersion
            .revisionNumber,
      },
      contentPreview:
        response.savedVersion.content
          .subjective,
      updatedAt:
        response.note.updatedAt,
    };
  }

  const response = event.response;
  const timelineEvent =
    response.timelineEvent;

  if (
    !isAllowedServerStatusChange(
      timelineEvent.fromStatus,
      timelineEvent.toStatus,
      event.trigger,
    )
  ) {
    return summary;
  }

  const assignedReviewerId =
    response.note
      .assignedReviewerId;

  const assignedReviewer =
    assignedReviewerId === null
      ? null
      : summary.assignedReviewer
          ?.id ===
        assignedReviewerId
      ? summary.assignedReviewer
      : response.timelineEvent
          .actorId ===
        assignedReviewerId
      ? {
          id: assignedReviewerId,
          displayName:
            response.timelineEvent
              .actorDisplayName,
        }
      : summary.assignedReviewer;

  return {
    ...summary,
    status: response.note.status,
    assignedReviewer,
    currentVersion: {
      id:
        response.currentVersion
          .versionId,
      revision:
        response.currentVersion
          .revisionNumber,
    },
    updatedAt:
      response.note.updatedAt,
  };
}

export function applyRealtimeEventToNoteSummaries(
  summaries:
    readonly NoteSummary[],
  event: NoteRealtimeEvent,
): NoteSummary[] {
  let changed = false;

  const next = summaries.map(
    summary => {
      const reconciled =
        applyRealtimeEventToNoteSummary(
          summary,
          event,
        );

      if (reconciled !== summary) {
        changed = true;
      }

      return reconciled;
    },
  );

  return changed
    ? next
    : (summaries as NoteSummary[]);
}
