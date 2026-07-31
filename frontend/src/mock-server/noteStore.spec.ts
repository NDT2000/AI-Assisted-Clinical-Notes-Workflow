import { beforeEach, describe, expect, it, } from "vitest";

import type { NoteDetail } from "../domain/noteDetail";
import type { NoteSummary } from "../domain/noteSummary";

import { getNoteDetail, getNotes, reassignNotes, regenerateNotes, seedNotes, } from "./noteStore";

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