import { beforeEach, describe, expect, it, } from "vitest";

import type { NoteDetail } from "../../domain/noteDetail";
import type { NoteSummary } from "../../domain/noteSummary";
import type { SaveNoteVersionActor, SaveNoteVersionRequestBody } from "../../domain/noteSave";

import { getNoteDetail, getNotes, reassignNotes, regenerateNotes, saveNoteVersion, seedNotes, } from "../noteStore";

function requireSummary(
  predicate: (
    note: NoteSummary,
  ) => boolean = () => true,
): NoteSummary {
  const summary = getNotes().find(predicate);

  if (!summary) {
    throw new Error(
      "Expected a matching note summary in the test dataset.",
    );
  }

  return summary;
}

function requireDetail(
  noteId: string,
): NoteDetail {
  const detail = getNoteDetail(noteId);

  if (!detail) {
    throw new Error(
      `Expected note detail for ${noteId}.`,
    );
  }

  return detail;
}

describe("noteStore detail storage", () => {
  beforeEach(() => {
    seedNotes(100, 42);
  });

  it("returns undefined when the note does not exist", () => {
    const detail = getNoteDetail(
      "note-does-not-exist",
    );

    expect(detail).toBeUndefined();
  });

  it("generates detail consistent with its summary", () => {
    const summary = requireSummary();
    const detail = requireDetail(summary.id);

    expect(detail.note.id).toBe(summary.id);

    expect(detail.note.status).toBe(
      summary.status,
    );

    expect(detail.patient.id).toBe(
      summary.patient.id,
    );

    expect(detail.patient.displayName).toBe(
      summary.patient.displayName,
    );

    expect(detail.note.patientId).toBe(
      detail.patient.id,
    );

    expect(detail.note.sessionId).toBe(
      detail.session.id,
    );

    expect(
      detail.note.currentVersionId,
    ).toBe(detail.currentVersion.versionId);

    expect(
      detail.currentVersion.revisionNumber,
    ).toBe(summary.currentVersion.revision);

    expect(
      detail.note.assignedReviewerId,
    ).toBe(
      detail.assignedReviewer?.id ?? null,
    );

    expect(detail.versions).toHaveLength(
      summary.currentVersion.revision,
    );

    const finalVersion =
      detail.versions[
        detail.versions.length - 1
      ];

    expect(finalVersion.versionId).toBe(
      detail.currentVersion.versionId,
    );
  });

  it("returns the cached detail when the same note is opened again", () => {
    const summary = requireSummary();

    const firstResult =
      requireDetail(summary.id);

    const secondResult =
      requireDetail(summary.id);

    expect(secondResult).toBe(firstResult);
  });

  it("invalidates cached detail when the reviewer changes", () => {
    const summary = requireSummary(
      (note) => note.status !== "LOCKED",
    );

    const originalDetail =
      requireDetail(summary.id);

    const newReviewer = {
      id: "reviewer-test",
      displayName: "Test Reviewer",
    };

    const updatedIds = reassignNotes(
      [summary.id],
      newReviewer,
    );

    expect(updatedIds).toEqual([
      summary.id,
    ]);

    const regeneratedDetail =
      requireDetail(summary.id);

    expect(regeneratedDetail).not.toBe(
      originalDetail,
    );

    expect(
      regeneratedDetail.assignedReviewer,
    ).toEqual({
      ...newReviewer,
      role: "REVIEWER",
    });

    expect(
      regeneratedDetail.note
        .assignedReviewerId,
    ).toBe(newReviewer.id);
  });

  it("invalidates cached detail when regeneration changes the status", () => {
    const failedSummary = requireSummary(
      (note) => note.status === "FAILED",
    );

    const originalDetail =
      requireDetail(failedSummary.id);

    const updatedIds = regenerateNotes(
      [failedSummary.id],
      "CLINICIAN",
    );

    expect(updatedIds).toEqual([
      failedSummary.id,
    ]);

    const updatedSummary = requireSummary(
      (note) =>
        note.id === failedSummary.id,
    );

    expect(updatedSummary.status).toBe(
      "GENERATING",
    );

    const regeneratedDetail =
      requireDetail(failedSummary.id);

    expect(regeneratedDetail).not.toBe(
      originalDetail,
    );

    expect(
      regeneratedDetail.note.status,
    ).toBe("GENERATING");
  });

  it("clears cached details when the dataset is reseeded", () => {
    const summary = requireSummary();

    const originalDetail =
      requireDetail(summary.id);

    seedNotes(100, 42);

    const regeneratedDetail =
      requireDetail(summary.id);

    expect(regeneratedDetail).not.toBe(
      originalDetail,
    );

    expect(regeneratedDetail).toEqual(
      originalDetail,
    );
  });
});

describe("noteStore version saving", () => {
  beforeEach(() => {
    seedNotes(100, 42);
  });

  const actor: SaveNoteVersionActor = {
    id: "reviewer-test",
    displayName: "Test Reviewer",
    role: "REVIEWER",
  };

  it("creates a new version and updates the detail and summary", () => {
    const summary = requireSummary();
    const originalDetail =
      requireDetail(summary.id);

    const originalVersionCount =
      originalDetail.versions.length;

    const request: SaveNoteVersionRequestBody =
      {
        baseVersionId:
          originalDetail.currentVersion
            .versionId,
        clientMutationId:
          "mutation-save-1",
        content: {
          subjective:
            "Patient reports improved sleep.",
          objective:
            "Patient appears alert and comfortable.",
          assessment:
            "Symptoms are improving.",
          plan:
            "Continue the current treatment plan.",
        },
      };

    const savedAt =
      "2026-07-31T21:30:00.000Z";

    const result = saveNoteVersion(
      summary.id,
      request,
      actor,
      savedAt,
    );

    expect(result.outcome).toBe("saved");

    if (result.outcome !== "saved") {
      throw new Error(
        "Expected the version to be saved.",
      );
    }

    expect(
      result.response.clientMutationId,
    ).toBe("mutation-save-1");

    expect(
      result.response.savedVersion
        .revisionNumber,
    ).toBe(
      originalDetail.currentVersion
        .revisionNumber + 1,
    );

    expect(
      result.response.savedVersion
        .parentVersionId,
    ).toBe(
      originalDetail.currentVersion
        .versionId,
    );

    expect(
      result.response.savedVersion.content,
    ).toEqual(request.content);

    expect(
      result.response.savedVersion.authorId,
    ).toBe(actor.id);

    expect(
      result.response.savedVersion
        .authorRole,
    ).toBe(actor.role);

    expect(
      result.response.savedVersion
        .authorDisplayName,
    ).toBe(actor.displayName);

    const updatedDetail =
      requireDetail(summary.id);

    expect(
      updatedDetail.currentVersion,
    ).toEqual(
      result.response.savedVersion,
    );

    expect(
      updatedDetail.versions,
    ).toHaveLength(
      originalVersionCount + 1,
    );

    expect(
      updatedDetail.versions[
        updatedDetail.versions.length - 1
      ],
    ).toEqual(
      result.response.savedVersion,
    );

    const updatedSummary =
      requireSummary(
        (note) => note.id === summary.id,
      );

    expect(
      updatedSummary.currentVersion,
    ).toEqual({
      id: result.response.savedVersion
        .versionId,
      revision:
        result.response.savedVersion
          .revisionNumber,
    });

    expect(
      updatedSummary.contentPreview,
    ).toBe(
      "Patient reports improved sleep.",
    );

    expect(updatedSummary.updatedAt).toBe(
      savedAt,
    );
  });

  it("does not save when the base version is stale", () => {
    const summary = requireSummary();
    const originalDetail =
      requireDetail(summary.id);

    const result = saveNoteVersion(
      summary.id,
      {
        baseVersionId:
          "stale-version-id",
        clientMutationId:
          "mutation-conflict-1",
        content: {
          subjective:
            "Conflicting subjective content",
          objective:
            "Conflicting objective content",
          assessment:
            "Conflicting assessment content",
          plan:
            "Conflicting plan content",
        },
      },
      actor,
      "2026-07-31T21:30:00.000Z",
    );

    expect(result).toEqual({
      outcome: "version-conflict",
      currentVersion:
        originalDetail.currentVersion,
    });

    const unchangedDetail =
      requireDetail(summary.id);

    expect(
      unchangedDetail.currentVersion,
    ).toEqual(
      originalDetail.currentVersion,
    );

    expect(
      unchangedDetail.versions,
    ).toEqual(originalDetail.versions);
  });

  it("returns not-found for an unknown note", () => {
    const result = saveNoteVersion(
      "note-does-not-exist",
      {
        baseVersionId: "version-1",
        clientMutationId:
          "mutation-missing-1",
        content: {
          subjective: "Subjective",
          objective: "Objective",
          assessment: "Assessment",
          plan: "Plan",
        },
      },
      actor,
    );

    expect(result).toEqual({
      outcome: "not-found",
    });
  });

  it("returns the original response when the same save is retried", () => {
    const summary = requireSummary();
    const originalDetail =
      requireDetail(summary.id);

    const request: SaveNoteVersionRequestBody = {
      baseVersionId:
        originalDetail.currentVersion
          .versionId,
      clientMutationId:
        "mutation-idempotent-1",
      content: {
        subjective:
          "Updated subjective",
        objective:
          "Updated objective",
        assessment:
          "Updated assessment",
        plan:
          "Updated plan",
      },
    };

    const firstResult = saveNoteVersion(
      summary.id,
      request,
      actor,
      "2026-07-31T21:30:00.000Z",
    );

    expect(firstResult.outcome).toBe(
      "saved",
    );

    if (firstResult.outcome !== "saved") {
      throw new Error(
        "Expected the first save to succeed.",
      );
    }

    const detailAfterFirstSave =
      requireDetail(summary.id);

    const versionCountAfterFirstSave =
      detailAfterFirstSave.versions.length;

    const retryResult = saveNoteVersion(
      summary.id,
      request,
      actor,
      "2026-07-31T21:35:00.000Z",
    );

    expect(retryResult.outcome).toBe(
      "saved",
    );

    if (retryResult.outcome !== "saved") {
      throw new Error(
        "Expected the retry to return the saved response.",
      );
    }

    expect(retryResult.response).toEqual(
      firstResult.response,
    );

    const detailAfterRetry =
      requireDetail(summary.id);

    expect(
      detailAfterRetry.versions,
    ).toHaveLength(
      versionCountAfterFirstSave,
    );

    expect(
      detailAfterRetry.currentVersion
        .versionId,
    ).toBe(
      firstResult.response.savedVersion
        .versionId,
    );

    expect(
      detailAfterRetry.currentVersion
        .createdAt,
    ).toBe(
      "2026-07-31T21:30:00.000Z",
    );
  });

  it("rejects reuse of a mutation ID with different content", () => {
    const summary = requireSummary();
    const originalDetail =
      requireDetail(summary.id);

    const firstResult = saveNoteVersion(
      summary.id,
      {
        baseVersionId:
          originalDetail.currentVersion
            .versionId,
        clientMutationId:
          "mutation-reused-1",
        content: {
          subjective:
            "First subjective",
          objective:
            "First objective",
          assessment:
            "First assessment",
          plan: "First plan",
        },
      },
      actor,
      "2026-07-31T21:30:00.000Z",
    );

    expect(firstResult.outcome).toBe(
      "saved",
    );

    const detailAfterFirstSave =
      requireDetail(summary.id);

    const result = saveNoteVersion(
      summary.id,
      {
        baseVersionId:
          originalDetail.currentVersion
            .versionId,
        clientMutationId:
          "mutation-reused-1",
        content: {
          subjective:
            "Different subjective",
          objective:
            "First objective",
          assessment:
            "First assessment",
          plan: "First plan",
        },
      },
      actor,
      "2026-07-31T21:35:00.000Z",
    );

    expect(result).toEqual({
      outcome: "idempotency-conflict",
    });

    const detailAfterConflict =
      requireDetail(summary.id);

    expect(
      detailAfterConflict.versions,
    ).toHaveLength(
      detailAfterFirstSave.versions.length,
    );

    expect(
      detailAfterConflict.currentVersion,
    ).toEqual(
      detailAfterFirstSave.currentVersion,
    );
  });
});