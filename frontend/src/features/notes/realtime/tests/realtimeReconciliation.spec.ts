import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  NoteDetail,
  NoteVersionDetail,
  ReviewTimelineEvent,
} from "../../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";
import type {
  NoteSummary,
} from "../../../../domain/noteSummary";
import type {
  TransitionNoteResponse,
} from "../../../../domain/noteTransition";
import {
  applyRealtimeEventToNoteDetail,
  applyRealtimeEventToNoteSummary,
} from "../realtimeReconciliation";

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
      `2026-08-02T12:0${revisionNumber}:00.000Z`,
  };
}

function createDetail(): NoteDetail {
  const currentVersion =
    createVersion(1);

  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status:
        "READY_FOR_REVIEW",
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId:
        null,
      createdAt:
        "2026-08-02T11:00:00.000Z",
      updatedAt:
        "2026-08-02T12:01:00.000Z",
    },
    patient: {
      id: "patient-1",
      displayName:
        "Patient One",
      dateOfBirth:
        "1990-01-01",
      medicalRecordNumber:
        "MRN-1",
    },
    session: {
      id: "session-1",
      startedAt:
        "2026-08-02T10:00:00.000Z",
      endedAt:
        "2026-08-02T11:00:00.000Z",
      clinician: {
        id: "clinician-1",
        displayName:
          "Clinician One",
        role: "CLINICIAN",
      },
    },
    assignedReviewer: null,
    currentVersion,
    versions: [currentVersion],
    timeline: [],
    presence: [],
  };
}

function createTransitionResponse():
  TransitionNoteResponse {
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
      toStatus: "IN_REVIEW",
      actorId: "reviewer-1",
      actorRole: "REVIEWER",
      actorDisplayName:
        "Reviewer One",
      occurredAt:
        "2026-08-02T12:10:00.000Z",
    };

  return {
    clientMutationId:
      "transition-1",
    note: {
      ...createDetail().note,
      status: "IN_REVIEW",
      assignedReviewerId:
        "reviewer-1",
      updatedAt:
        timelineEvent.occurredAt,
    },
    timelineEvent,
    currentVersion,
  };
}

describe(
  "real-time reconciliation",
  () => {
    it(
      "replaces an optimistic transition event and applies the authoritative status once",
      () => {
        const detail =
          createDetail();

        detail.note.status =
          "IN_REVIEW";

        detail.timeline = [
          {
            eventId:
              "optimistic-transition-1",
            noteId: "note-1",
            versionId:
              "version-1",
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
              "2026-08-02T12:09:59.000Z",
          },
        ];

        const response =
          createTransitionResponse();

        const event = {
          type:
            "note.status_changed",
          eventId:
            "status-event-1",
          cursor: 1,
          noteId: "note-1",
          occurredAt:
            "2026-08-02T12:10:00.000Z",
          trigger:
            "START_REVIEW",
          response,
        } as const;

        const first =
          applyRealtimeEventToNoteDetail(
            detail,
            event,
          );

        const second =
          applyRealtimeEventToNoteDetail(
            first,
            event,
          );

        expect(
          first.timeline,
        ).toEqual([
          response.timelineEvent,
        ]);

        expect(
          second.timeline,
        ).toHaveLength(1);
      },
    );

    it(
      "deduplicates a version echo that arrives before REST acknowledgement",
      () => {
        const detail =
          createDetail();

        const savedVersion =
          createVersion(2);

        const response:
          SaveNoteVersionResponse = {
            clientMutationId:
              "save-1",
            note: {
              ...detail.note,
              currentVersionId:
                savedVersion.versionId,
              updatedAt:
                savedVersion.createdAt,
            },
            savedVersion,
          };

        const event = {
          type:
            "note.version_added",
          eventId:
            "version-event-1",
          cursor: 2,
          noteId: "note-1",
          occurredAt:
            savedVersion.createdAt,
          response,
        } as const;

        const first =
          applyRealtimeEventToNoteDetail(
            detail,
            event,
          );

        const second =
          applyRealtimeEventToNoteDetail(
            first,
            event,
          );

        expect(
          first.versions,
        ).toHaveLength(2);

        expect(
          second.versions,
        ).toHaveLength(2);

        expect(
          second.currentVersion
            .versionId,
        ).toBe("version-2");
      },
    );

    it(
      "updates the lightweight list projection",
      () => {
        const summary:
          NoteSummary = {
          id: "note-1",
          patient: {
            id: "patient-1",
            displayName:
              "Patient One",
          },
          status:
            "READY_FOR_REVIEW",
          currentVersion: {
            id: "version-1",
            revision: 1,
          },
          assignedReviewer: null,
          contentPreview:
            "Subjective 1",
          createdAt:
            "2026-08-02T11:00:00.000Z",
          updatedAt:
            "2026-08-02T12:01:00.000Z",
        };

        const response =
          createTransitionResponse();

        const next =
          applyRealtimeEventToNoteSummary(
            summary,
            {
              type:
                "note.status_changed",
              eventId:
                "status-event-1",
              cursor: 1,
              noteId: "note-1",
              occurredAt:
                response.timelineEvent
                  .occurredAt,
              trigger:
                "START_REVIEW",
              response,
            },
          );

        expect(next.status).toBe(
          "IN_REVIEW",
        );
      },
    );
  },
);

describe("late and replayed events", () => {
  function laterDetail(): NoteDetail {
    // What the page shows after a newer change (12:20) was applied.
    const detail = createDetail();
    return {
      ...detail,
      note: {
        ...detail.note,
        status: "IN_REVIEW",
        updatedAt: "2026-08-02T12:20:00.000Z",
      },
    };
  }

  it("does not go back to an older status", () => {
    const detail = laterDetail();
    const response = createTransitionResponse(); // 12:10

    const next = applyRealtimeEventToNoteDetail(detail, {
      type: "note.status_changed",
      eventId: "late-status",
      cursor: 3,
      noteId: "note-1",
      occurredAt: response.timelineEvent.occurredAt,
      trigger: "START_REVIEW",
      response,
    });

    expect(next).toBe(detail);
  });

  it("keeps an older version in the history without showing it", () => {
    const detail = laterDetail();
    const older = createVersion(2);
    const response: SaveNoteVersionResponse = {
      clientMutationId: "save-late",
      note: {
        ...detail.note,
        currentVersionId: older.versionId,
        updatedAt: "2026-08-02T12:15:00.000Z",
      },
      savedVersion: older,
    };
    const event = {
      type: "note.version_added" as const,
      eventId: "late-version",
      cursor: 4,
      noteId: "note-1",
      occurredAt: response.note.updatedAt,
      response,
    };

    const next = applyRealtimeEventToNoteDetail(detail, event);

    expect(next.currentVersion).toBe(detail.currentVersion);
    expect(next.note).toBe(detail.note);
    expect(next.versions.map((version) => version.versionId)).toEqual([
      "version-1",
      "version-2",
    ]);
    // Replayed again: nothing changes.
    expect(applyRealtimeEventToNoteDetail(next, event)).toBe(next);
  });

  it("still applies others' changes while an own action is pending", () => {
    const detail = laterDetail();
    const pending: NoteDetail = {
      ...detail,
      timeline: [
        {
          eventId: "optimistic-transition-1",
          noteId: "note-1",
          versionId: "version-1",
          fromStatus: "READY_FOR_REVIEW",
          toStatus: "IN_REVIEW",
          actorId: "reviewer-1",
          actorRole: "REVIEWER",
          actorDisplayName: "Reviewer One",
          // The browser's clock, possibly ahead of the server's.
          occurredAt: "2026-08-02T13:00:00.000Z",
        },
      ],
      note: { ...detail.note, updatedAt: "2026-08-02T13:00:00.000Z" },
    };
    const response = createTransitionResponse();

    const next = applyRealtimeEventToNoteDetail(pending, {
      type: "note.status_changed",
      eventId: "server-status",
      cursor: 5,
      noteId: "note-1",
      occurredAt: response.timelineEvent.occurredAt,
      trigger: "START_REVIEW",
      response,
    });

    expect(next.note.updatedAt).toBe(response.note.updatedAt);
  });

  it("does not go back in the list either", () => {
    const summary: NoteSummary = {
      id: "note-1",
      patient: { id: "patient-1", displayName: "Patient One" },
      status: "APPROVED",
      currentVersion: { id: "version-3", revision: 3 },
      assignedReviewer: null,
      contentPreview: "Subjective 3",
      createdAt: "2026-08-02T11:00:00.000Z",
      updatedAt: "2026-08-02T12:30:00.000Z",
    };
    const response = createTransitionResponse(); // 12:10

    const next = applyRealtimeEventToNoteSummary(summary, {
      type: "note.status_changed",
      eventId: "late-status",
      cursor: 3,
      noteId: "note-1",
      occurredAt: response.timelineEvent.occurredAt,
      trigger: "START_REVIEW",
      response,
    });

    expect(next).toBe(summary);
  });
});

