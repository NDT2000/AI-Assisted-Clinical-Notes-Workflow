import {
  describe,
  expect,
  it,
} from "vitest";

import type { Actor } from "../../../../domain/actor";
import type { NoteStatus } from "../../../../domain/noteAttributes";
import type {
  NoteDetail,
  NoteVersionDetail,
} from "../../../../domain/noteDetail";
import type { TransitionNoteResponse } from "../../../../domain/noteTransition";
import {
  applyTransitionResponse,
  buildOptimisticDetail,
} from "../useOptimisticNoteTransition";

const reviewer: Actor = {
  id: "reviewer-1",
  displayName: "Alex Kim",
  role: "REVIEWER",
  mfaVerified: true,
};

const NOW = "2026-08-02T12:00:00.000Z";

const version: NoteVersionDetail = {
  versionId: "version-1",
  noteId: "note-1",
  revisionNumber: 1,
  parentVersionId: null,
  content: {
    subjective: "S",
    objective: "O",
    assessment: "A",
    plan: "P",
  },
  authorId: "clinician-1",
  authorRole: "CLINICIAN",
  authorDisplayName: "Dr. Maya Brooks",
  createdAt: "2026-08-02T10:00:00.000Z",
};

function createDetail(
  status: NoteStatus,
  assignedReviewerId: string | null = null,
): NoteDetail {
  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status,
      currentVersionId: version.versionId,
      assignedReviewerId,
      createdAt: "2026-08-02T09:00:00.000Z",
      updatedAt: "2026-08-02T10:00:00.000Z",
    },
    patient: {
      id: "patient-1",
      displayName: "Patient One",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber: "MRN-1",
    },
    session: {
      id: "session-1",
      startedAt: "2026-08-02T08:00:00.000Z",
      endedAt: "2026-08-02T08:30:00.000Z",
      clinician: {
        id: "clinician-1",
        displayName: "Dr. Maya Brooks",
        role: "CLINICIAN",
      },
    },
    assignedReviewer:
      assignedReviewerId === null
        ? null
        : {
            id: assignedReviewerId,
            displayName: "Alex Kim",
            role: "REVIEWER",
          },
    currentVersion: version,
    versions: [version],
    timeline: [],
    presence: [],
  };
}

describe("buildOptimisticDetail", () => {
  it("starts a review and assigns the acting reviewer", () => {
    const next = buildOptimisticDetail(
      createDetail("READY_FOR_REVIEW"),
      {
        baseVersionId: version.versionId,
        trigger: "START_REVIEW",
      },
      reviewer,
      NOW,
      "optimistic-transition-1",
    );

    expect(next?.note.status).toBe("IN_REVIEW");
    expect(next?.note.assignedReviewerId).toBe(
      "reviewer-1",
    );
    expect(next?.timeline).toEqual([
      expect.objectContaining({
        eventId: "optimistic-transition-1",
        fromStatus: "READY_FOR_REVIEW",
        toStatus: "IN_REVIEW",
        actorId: "reviewer-1",
      }),
    ]);
  });

  it("returns null when the guards reject the action", () => {
    expect(
      buildOptimisticDetail(
        createDetail("LOCKED"),
        {
          baseVersionId: version.versionId,
          trigger: "START_REVIEW",
        },
        reviewer,
        NOW,
        "optimistic-transition-2",
      ),
    ).toBeNull();
  });

  it("releases the reviewer when a review is returned to the queue", () => {
    const next = buildOptimisticDetail(
      createDetail("IN_REVIEW", "reviewer-1"),
      {
        baseVersionId: version.versionId,
        trigger: "RETURN_TO_QUEUE",
      },
      reviewer,
      NOW,
      "optimistic-transition-3",
    );

    expect(next?.note.status).toBe(
      "READY_FOR_REVIEW",
    );
    expect(next?.assignedReviewer).toBeNull();
  });
});

describe("applyTransitionResponse", () => {
  it("replaces the placeholder event with the server's event", () => {
    const optimistic = buildOptimisticDetail(
      createDetail("READY_FOR_REVIEW"),
      {
        baseVersionId: version.versionId,
        trigger: "START_REVIEW",
      },
      reviewer,
      NOW,
      "optimistic-transition-4",
    )!;

    const response: TransitionNoteResponse = {
      clientMutationId: "mutation-1",
      note: {
        ...optimistic.note,
        status: "IN_REVIEW",
        assignedReviewerId: "reviewer-1",
      },
      currentVersion: version,
      timelineEvent: {
        eventId: "server-event-1",
        noteId: "note-1",
        versionId: version.versionId,
        fromStatus: "READY_FOR_REVIEW",
        toStatus: "IN_REVIEW",
        actorId: "reviewer-1",
        actorRole: "REVIEWER",
        actorDisplayName: "Alex Kim",
        occurredAt: NOW,
      },
    };

    const reconciled = applyTransitionResponse(
      optimistic,
      response,
      "optimistic-transition-4",
    );

    expect(
      reconciled.timeline.map(
        event => event.eventId,
      ),
    ).toEqual(["server-event-1"]);
    expect(reconciled.assignedReviewer?.id).toBe(
      "reviewer-1",
    );
  });
});
