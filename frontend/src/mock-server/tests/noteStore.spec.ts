import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  NoteDetail,
} from "../../domain/noteDetail";
import type {
  NoteSummary,
} from "../../domain/noteSummary";
import type {
  SaveNoteVersionActor,
  SaveNoteVersionRequestBody,
} from "../../domain/noteSave";
import type {
  TransitionNoteActor,
} from "../../domain/noteTransition";
import {
  getNoteDetail,
  getNotes,
  reassignNotes,
  regenerateNotes,
  saveNoteVersion,
  seedNotes,
  transitionNote,
} from "../noteStore";

function requireSummary(
  predicate: (
    note: NoteSummary,
  ) => boolean,
): NoteSummary {
  const summary =
    getNotes().find(predicate);

  if (!summary) {
    throw new Error(
      "Expected a matching note summary.",
    );
  }

  return summary;
}

function requireDetail(
  noteId: string,
): NoteDetail {
  const detail =
    getNoteDetail(noteId);

  if (!detail) {
    throw new Error(
      `Expected note detail for ${noteId}.`,
    );
  }

  return detail;
}

function createReviewer(
  id = "reviewer-authorization-1",
): TransitionNoteActor {
  return {
    id,
    displayName:
      `Reviewer ${id}`,
    role: "REVIEWER",
    mfaVerified: true,
  };
}

function createSaveRequest(
  detail: NoteDetail,
  clientMutationId: string,
): SaveNoteVersionRequestBody {
  return {
    baseVersionId:
      detail.currentVersion
        .versionId,
    clientMutationId,
    content: {
      subjective:
        "Updated subjective content.",
      objective:
        "Updated objective content.",
      assessment:
        "Updated assessment content.",
      plan:
        "Updated plan content.",
    },
  };
}

function prepareReadyNote():
  NoteDetail {
  const summary =
    requireSummary(
      note =>
        note.status ===
        "READY_FOR_REVIEW",
    );

  reassignNotes(
    [summary.id],
    null,
    "ADMIN",
  );

  return requireDetail(
    summary.id,
  );
}

function startReview(
  reviewer:
    TransitionNoteActor =
      createReviewer(),
): NoteDetail {
  const detail =
    prepareReadyNote();

  const result =
    transitionNote(
      detail.note.id,
      {
        baseVersionId:
          detail.currentVersion
            .versionId,
        clientMutationId:
          `start-${reviewer.id}`,
        trigger:
          "START_REVIEW",
      },
      reviewer,
      "2026-08-02T12:00:00.000Z",
    );

  expect(
    result.outcome,
  ).toBe("transitioned");

  return requireDetail(
    detail.note.id,
  );
}

describe(
  "noteStore",
  () => {
    beforeEach(() => {
      seedNotes(500, 42);
    });

    it(
      "generates detail consistent with its summary",
      () => {
        const summary =
          requireSummary(
            () => true,
          );

        const detail =
          requireDetail(
            summary.id,
          );

        expect(
          detail.note.id,
        ).toBe(summary.id);

        expect(
          detail.note.status,
        ).toBe(
          summary.status,
        );

        expect(
          detail.note
            .currentVersionId,
        ).toBe(
          detail.currentVersion
            .versionId,
        );

        expect(
          detail.note
            .assignedReviewerId,
        ).toBe(
          detail.assignedReviewer
            ?.id ?? null,
        );
      },
    );

    it(
      "assigns reviewers only to eligible notes and authorized roles",
      () => {
        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const inReview =
          requireSummary(
            note =>
              note.status ===
              "IN_REVIEW",
          );

        const reviewer = {
          id: "reviewer-new",
          displayName:
            "New Reviewer",
        };

        expect(
          reassignNotes(
            [
              ready.id,
              inReview.id,
            ],
            reviewer,
            "CLINICIAN",
          ),
        ).toEqual([
          ready.id,
        ]);

        expect(
          requireDetail(
            ready.id,
          ).assignedReviewer,
        ).toEqual({
          ...reviewer,
          role: "REVIEWER",
        });

        const anotherReady =
          requireSummary(
            note =>
              note.status ===
                "READY_FOR_REVIEW" &&
              note.id !== ready.id,
          );

        expect(
          reassignNotes(
            [anotherReady.id],
            reviewer,
            "REVIEWER",
          ),
        ).toEqual([]);
      },
    );

    it(
      "regenerates only failed notes for an authorized role",
      () => {
        const failed =
          requireSummary(
            note =>
              note.status ===
              "FAILED",
          );

        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        expect(
          regenerateNotes(
            [
              failed.id,
              ready.id,
            ],
            "CLINICIAN",
          ),
        ).toEqual([
          failed.id,
        ]);

        expect(
          requireSummary(
            note =>
              note.id ===
              failed.id,
          ).status,
        ).toBe("GENERATING");

        expect(
          regenerateNotes(
            [ready.id],
            "REVIEWER",
          ),
        ).toEqual([]);
      },
    );

    it(
      "assigns the acting reviewer when review starts",
      () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareReadyNote();

        const result =
          transitionNote(
            detail.note.id,
            {
              baseVersionId:
                detail.currentVersion
                  .versionId,
              clientMutationId:
                "start-review-1",
              trigger:
                "START_REVIEW",
            },
            reviewer,
            "2026-08-02T12:00:00.000Z",
          );

        expect(
          result.outcome,
        ).toBe("transitioned");

        if (
          result.outcome !==
          "transitioned"
        ) {
          throw new Error(
            "Expected review to start.",
          );
        }

        expect(
          result.response.note
            .assignedReviewerId,
        ).toBe(reviewer.id);

        expect(
          requireDetail(
            detail.note.id,
          ).assignedReviewer,
        ).toEqual({
          id: reviewer.id,
          displayName:
            reviewer.displayName,
          role: "REVIEWER",
        });
      },
    );

    it(
      "rejects review start when another reviewer owns the note",
      () => {
        const detail =
          prepareReadyNote();

        reassignNotes(
          [detail.note.id],
          {
            id: "reviewer-owner",
            displayName:
              "Current Owner",
          },
          "ADMIN",
        );

        const refreshed =
          requireDetail(
            detail.note.id,
          );

        expect(
          transitionNote(
            refreshed.note.id,
            {
              baseVersionId:
                refreshed
                  .currentVersion
                  .versionId,
              clientMutationId:
                "start-review-other",
              trigger:
                "START_REVIEW",
            },
            createReviewer(
              "reviewer-other",
            ),
          ),
        ).toEqual({
          outcome:
            "transition-rejected",
          reason:
            "This note is assigned to another reviewer.",
        });
      },
    );

    it(
      "releases reviewer ownership when a note returns to the queue",
      () => {
        const reviewer =
          createReviewer();

        const inReview =
          startReview(reviewer);

        const result =
          transitionNote(
            inReview.note.id,
            {
              baseVersionId:
                inReview
                  .currentVersion
                  .versionId,
              clientMutationId:
                "return-to-queue-1",
              trigger:
                "RETURN_TO_QUEUE",
            },
            reviewer,
            "2026-08-02T12:05:00.000Z",
          );

        expect(
          result.outcome,
        ).toBe("transitioned");

        const updated =
          requireDetail(
            inReview.note.id,
          );

        expect(
          updated.note.status,
        ).toBe(
          "READY_FOR_REVIEW",
        );

        expect(
          updated.note
            .assignedReviewerId,
        ).toBeNull();

        expect(
          updated.assignedReviewer,
        ).toBeNull();
      },
    );

    it(
      "allows only the assigned reviewer to save an in-review note",
      () => {
        const reviewer =
          createReviewer();

        const inReview =
          startReview(reviewer);

        const unauthorized =
          saveNoteVersion(
            inReview.note.id,
            createSaveRequest(
              inReview,
              "save-wrong-reviewer",
            ),
            {
              id: "reviewer-other",
              displayName:
                "Other Reviewer",
              role: "REVIEWER",
            },
          );

        expect(
          unauthorized,
        ).toEqual({
          outcome: "forbidden",
          reason:
            "Only the assigned reviewer can edit this note.",
        });

        const authorized =
          saveNoteVersion(
            inReview.note.id,
            createSaveRequest(
              inReview,
              "save-assigned-reviewer",
            ),
            reviewer,
            "2026-08-02T12:10:00.000Z",
          );

        expect(
          authorized.outcome,
        ).toBe("saved");
      },
    );

    it(
      "denies a read-only auditor at the store boundary",
      () => {
        const inReview =
          startReview();

        const actor:
          SaveNoteVersionActor = {
          id: "auditor-1",
          displayName:
            "Read-only Auditor",
          role:
            "READONLY_AUDITOR",
        };

        expect(
          saveNoteVersion(
            inReview.note.id,
            createSaveRequest(
              inReview,
              "save-auditor",
            ),
            actor,
          ),
        ).toEqual({
          outcome: "forbidden",
          reason:
            "Read-only auditors cannot edit note content.",
        });
      },
    );

    it(
      "allows a clinician to correct a rejected note and releases ownership on resubmission",
      () => {
        const reviewer =
          createReviewer();

        const inReview =
          startReview(reviewer);

        const rejected =
          transitionNote(
            inReview.note.id,
            {
              baseVersionId:
                inReview
                  .currentVersion
                  .versionId,
              clientMutationId:
                "reject-note-1",
              trigger: "REJECT",
              rejectionReason:
                "The assessment needs clarification.",
            },
            reviewer,
            "2026-08-02T12:15:00.000Z",
          );

        expect(
          rejected.outcome,
        ).toBe("transitioned");

        const rejectedDetail =
          requireDetail(
            inReview.note.id,
          );

        const clinician:
          SaveNoteVersionActor = {
          id: "clinician-1",
          displayName:
            "Current Clinician",
          role: "CLINICIAN",
        };

        const saveResult =
          saveNoteVersion(
            rejectedDetail.note.id,
            createSaveRequest(
              rejectedDetail,
              "save-rejected-1",
            ),
            clinician,
            "2026-08-02T12:20:00.000Z",
          );

        expect(
          saveResult.outcome,
        ).toBe("saved");

        if (
          saveResult.outcome !==
          "saved"
        ) {
          throw new Error(
            "Expected the clinician save to succeed.",
          );
        }

        const resubmitted =
          transitionNote(
            rejectedDetail.note.id,
            {
              baseVersionId:
                saveResult.response
                  .savedVersion
                  .versionId,
              clientMutationId:
                "resubmit-note-1",
              trigger: "RESUBMIT",
            },
            clinician,
            "2026-08-02T12:25:00.000Z",
          );

        expect(
          resubmitted.outcome,
        ).toBe("transitioned");

        const updated =
          requireDetail(
            rejectedDetail.note.id,
          );

        expect(
          updated.note.status,
        ).toBe(
          "READY_FOR_REVIEW",
        );

        expect(
          updated.note
            .assignedReviewerId,
        ).toBeNull();
      },
    );

    it(
      "returns the original response for an idempotent save retry",
      () => {
        const reviewer =
          createReviewer();

        const inReview =
          startReview(reviewer);

        const request =
          createSaveRequest(
            inReview,
            "save-idempotent-1",
          );

        const first =
          saveNoteVersion(
            inReview.note.id,
            request,
            reviewer,
            "2026-08-02T12:30:00.000Z",
          );

        const second =
          saveNoteVersion(
            inReview.note.id,
            request,
            reviewer,
            "2026-08-02T12:35:00.000Z",
          );

        expect(
          first.outcome,
        ).toBe("saved");

        expect(second).toEqual(first);

        const detail =
          requireDetail(
            inReview.note.id,
          );

        expect(
          detail.versions,
        ).toHaveLength(
          inReview.versions.length +
            1,
        );
      },
    );

    it(
      "returns a version conflict for an authorized stale save",
      () => {
        const reviewer =
          createReviewer();

        const inReview =
          startReview(reviewer);

        const result =
          saveNoteVersion(
            inReview.note.id,
            {
              ...createSaveRequest(
                inReview,
                "save-stale-1",
              ),
              baseVersionId:
                "stale-version-id",
            },
            reviewer,
          );

        expect(
          result.outcome,
        ).toBe(
          "version-conflict",
        );
      },
    );
  },
);
