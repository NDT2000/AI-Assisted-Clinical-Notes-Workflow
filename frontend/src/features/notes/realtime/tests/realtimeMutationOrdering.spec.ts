import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteVersionDetail,
  ReviewTimelineEvent,
} from "../../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";
import type {
  TransitionNoteResponse,
} from "../../../../domain/noteTransition";
import {
  saveNoteVersion,
} from "../../api/saveNoteVersion";
import {
  transitionNote,
} from "../../api/transitionNote";
import {
  mockRealtimeChannel,
} from "../mockRealtimeChannel";

function createVersion(
  revisionNumber: number,
): NoteVersionDetail {
  return {
    versionId:
      `version-${revisionNumber}`,
    noteId: "note-1",
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

function createNote(
  currentVersionId: string,
  status:
    | "READY_FOR_REVIEW"
    | "IN_REVIEW",
) {
  return {
    id: "note-1",
    patientId: "patient-1",
    sessionId: "session-1",
    status,
    currentVersionId,
    assignedReviewerId:
      "reviewer-1",
    createdAt:
      "2026-08-02T11:00:00.000Z",
    updatedAt:
      "2026-08-02T12:00:00.000Z",
  } as const;
}

describe(
  "real-time mutation ordering",
  () => {
    beforeEach(() => {
      mockRealtimeChannel.reset();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      mockRealtimeChannel.reset();
    });

    it(
      "delivers a version echo before the save promise acknowledges",
      async () => {
        const savedVersion =
          createVersion(2);

        const response:
          SaveNoteVersionResponse = {
            clientMutationId:
              "save-mutation-1",
            note: createNote(
              savedVersion.versionId,
              "IN_REVIEW",
            ),
            savedVersion,
          };

        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(
                JSON.stringify(
                  response,
                ),
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "application/json",
                  },
                },
              ),
          ),
        );

        const order:
          string[] = [];

        const connection =
          mockRealtimeChannel.connect({
            noteIds: ["note-1"],
            afterCursor: 0,
            onEvent: () => {
              order.push("event");
            },
            onDisconnect:
              vi.fn(),
          });

        await saveNoteVersion(
          "note-1",
          {
            id: "reviewer-1",
            displayName:
              "Reviewer One",
            role: "REVIEWER",
          },
          {
            baseVersionId:
              "version-1",
            clientMutationId:
              "save-mutation-1",
            content:
              savedVersion.content,
          },
        ).then(() => {
          order.push("ack");
        });

        expect(order).toEqual([
          "event",
          "ack",
        ]);

        connection.disconnect();
      },
    );

    it(
      "delivers a status echo before the transition promise acknowledges",
      async () => {
        const currentVersion =
          createVersion(1);

        const timelineEvent:
          ReviewTimelineEvent = {
          eventId:
            "timeline-1",
          noteId: "note-1",
          versionId:
            currentVersion.versionId,
          fromStatus:
            "READY_FOR_REVIEW",
          toStatus:
            "IN_REVIEW",
          actorId:
            "reviewer-1",
          actorRole:
            "REVIEWER",
          actorDisplayName:
            "Reviewer One",
          occurredAt:
            "2026-08-02T12:00:00.000Z",
        };

        const response:
          TransitionNoteResponse = {
            clientMutationId:
              "transition-mutation-1",
            note: createNote(
              currentVersion.versionId,
              "IN_REVIEW",
            ),
            timelineEvent,
            currentVersion,
          };

        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(
                JSON.stringify(
                  response,
                ),
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "application/json",
                  },
                },
              ),
          ),
        );

        const order:
          string[] = [];

        const connection =
          mockRealtimeChannel.connect({
            noteIds: ["note-1"],
            afterCursor: 0,
            onEvent: () => {
              order.push("event");
            },
            onDisconnect:
              vi.fn(),
          });

        await transitionNote(
          "note-1",
          {
            id: "reviewer-1",
            displayName:
              "Reviewer One",
            role: "REVIEWER",
          },
          {
            baseVersionId:
              currentVersion.versionId,
            trigger:
              "START_REVIEW",
            clientMutationId:
              "transition-mutation-1",
          },
        ).then(() => {
          order.push("ack");
        });

        expect(order).toEqual([
          "event",
          "ack",
        ]);

        connection.disconnect();
      },
    );
  },
);
