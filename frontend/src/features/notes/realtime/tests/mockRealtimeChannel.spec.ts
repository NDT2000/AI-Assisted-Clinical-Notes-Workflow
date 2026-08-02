import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteVersionDetail,
  PresenceUser,
  ReviewTimelineEvent,
} from "../../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";
import type {
  TransitionNoteResponse,
} from "../../../../domain/noteTransition";
import {
  MockRealtimeChannel,
} from "../mockRealtimeChannel";

function createVersion(
  noteId: string,
  revisionNumber: number,
): NoteVersionDetail {
  return {
    versionId:
      `version-${revisionNumber}`,
    noteId,
    revisionNumber,
    parentVersionId:
      revisionNumber === 1
        ? null
        : `version-${
            revisionNumber - 1
          }`,
    content: {
      subjective:
        `Subjective ${revisionNumber}`,
      objective:
        `Objective ${revisionNumber}`,
      assessment:
        `Assessment ${revisionNumber}`,
      plan:
        `Plan ${revisionNumber}`,
    },
    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Reviewer One",
    createdAt:
      "2026-08-02T12:00:00.000Z",
  };
}

function createSaveResponse(
  noteId: string,
): SaveNoteVersionResponse {
  const savedVersion =
    createVersion(noteId, 2);

  return {
    clientMutationId:
      "save-mutation-1",
    note: {
      id: noteId,
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId:
        savedVersion.versionId,
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-08-02T11:00:00.000Z",
      updatedAt:
        "2026-08-02T12:00:00.000Z",
    },
    savedVersion,
  };
}

function createTransitionResponse(
  noteId: string,
): TransitionNoteResponse {
  const currentVersion =
    createVersion(noteId, 1);

  const timelineEvent:
    ReviewTimelineEvent = {
      eventId:
        "timeline-event-1",
      noteId,
      versionId:
        currentVersion.versionId,
      fromStatus:
        "READY_FOR_REVIEW",
      toStatus: "IN_REVIEW",
      actorId: "reviewer-1",
      actorRole: "REVIEWER",
      actorDisplayName:
        "Reviewer One",
      occurredAt:
        "2026-08-02T12:00:00.000Z",
    };

  return {
    clientMutationId:
      "transition-mutation-1",
    note: {
      id: noteId,
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-08-02T11:00:00.000Z",
      updatedAt:
        "2026-08-02T12:00:00.000Z",
    },
    timelineEvent,
    currentVersion,
  };
}

describe(
  "MockRealtimeChannel",
  () => {
    let channel:
      MockRealtimeChannel;

    beforeEach(() => {
      channel =
        new MockRealtimeChannel({
          now: () =>
            "2026-08-02T12:00:00.000Z",
        });
    });

    it(
      "emits status, version, and presence events only to matching notes",
      () => {
        const noteOneEvents:
          string[] = [];

        const noteTwoEvents:
          string[] = [];

        channel.connect({
          noteIds: ["note-1"],
          afterCursor: 0,
          onEvent: event => {
            noteOneEvents.push(
              event.type,
            );
          },
          onDisconnect:
            vi.fn(),
        });

        channel.connect({
          noteIds: ["note-2"],
          afterCursor: 0,
          onEvent: event => {
            noteTwoEvents.push(
              event.type,
            );
          },
          onDisconnect:
            vi.fn(),
        });

        channel.publish({
          type:
            "note.status_changed",
          noteId: "note-1",
          trigger: "START_REVIEW",
          response:
            createTransitionResponse(
              "note-1",
            ),
        });

        channel.publish({
          type:
            "note.version_added",
          noteId: "note-1",
          response:
            createSaveResponse(
              "note-1",
            ),
        });

        const presence:
          PresenceUser[] = [];

        channel.publish({
          type:
            "note.presence_changed",
          noteId: "note-2",
          presence,
        });

        expect(
          noteOneEvents,
        ).toEqual([
          "note.status_changed",
          "note.version_added",
        ]);

        expect(
          noteTwoEvents,
        ).toEqual([
          "note.presence_changed",
        ]);
      },
    );

    it(
      "replays events after the supplied cursor",
      () => {
        const first =
          channel.publish({
            type:
              "note.presence_changed",
            noteId: "note-1",
            presence: [],
          });

        const second =
          channel.publish({
            type:
              "note.version_added",
            noteId: "note-1",
            response:
              createSaveResponse(
                "note-1",
              ),
          });

        const received:
          number[] = [];

        channel.connect({
          noteIds: ["note-1"],
          afterCursor:
            first.cursor,
          onEvent: event => {
            received.push(
              event.cursor,
            );
          },
          onDisconnect:
            vi.fn(),
        });

        expect(received).toEqual([
          second.cursor,
        ]);
      },
    );

    it(
      "can duplicate and drop deliveries without duplicating the event log",
      () => {
        const onEvent = vi.fn();

        channel.connect({
          noteIds: ["note-1"],
          afterCursor: 0,
          onEvent,
          onDisconnect:
            vi.fn(),
        });

        const event =
          channel.publish({
            type:
              "note.presence_changed",
            noteId: "note-1",
            presence: [],
            eventId:
              "presence-1",
          });

        expect(
          channel.duplicateEvent(
            event.eventId,
          ),
        ).toBe(true);

        expect(onEvent).toHaveBeenCalledTimes(
          2,
        );

        expect(
          channel.getEventsAfter(0),
        ).toHaveLength(1);

        channel.dropNextDeliveriesForAll();

        channel.publish({
          type:
            "note.presence_changed",
          noteId: "note-1",
          presence: [],
        });

        expect(onEvent).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "updates note subscriptions and cleans up disconnected connections",
      () => {
        const received:
          string[] = [];

        const connection =
          channel.connect({
            noteIds: ["note-1"],
            afterCursor: 0,
            onEvent: event => {
              received.push(
                event.noteId,
              );
            },
            onDisconnect:
              vi.fn(),
          });

        connection.updateNoteIds([
          "note-2",
        ]);

        channel.publish({
          type:
            "note.presence_changed",
          noteId: "note-1",
          presence: [],
        });

        channel.publish({
          type:
            "note.presence_changed",
          noteId: "note-2",
          presence: [],
        });

        expect(received).toEqual([
          "note-2",
        ]);

        connection.disconnect();

        expect(
          channel.getConnectionCount(),
        ).toBe(0);
      },
    );
  },
);
