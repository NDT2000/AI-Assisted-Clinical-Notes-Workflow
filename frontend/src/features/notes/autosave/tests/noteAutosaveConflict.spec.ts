import { describe, expect, it, } from "vitest";

import type {  NoteVersionDetail, } from "../../../../domain/noteDetail";
import { SaveNoteVersionRequestError, } from "../../api/saveNoteVersion"; 
import { getNoteAutosaveConflict, } from "../noteAutosaveConflict";

function createVersion(
  versionId: string,
  revisionNumber: number,
  parentVersionId: string | null,
): NoteVersionDetail {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber,
    parentVersionId,
    content: {
      subjective: "Subjective",
      objective: "Objective",
      assessment: "Assessment",
      plan: "Plan",
    },
    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Current Reviewer",
    createdAt:
      "2026-08-01T12:00:00.000Z",
  };
}

describe(
  "getNoteAutosaveConflict",
  () => {
    it(
      "returns the server head and common ancestor from a conflict error",
      () => {
        const commonAncestor =
          createVersion(
            "version-1",
            1,
            null,
          );

        const currentVersion =
          createVersion(
            "version-2",
            2,
            "version-1",
          );

        const error =
          new SaveNoteVersionRequestError({
            status: 409,
            code: "version_conflict",
            message:
              "The note was updated elsewhere.",
            currentVersion,
            commonAncestor,
          });

        expect(
          getNoteAutosaveConflict(error),
        ).toEqual({
          message:
            "The note was updated elsewhere.",
          currentVersion,
          commonAncestor,
        });
      },
    );

    it(
      "preserves a null common ancestor",
      () => {
        const currentVersion =
          createVersion(
            "version-2",
            2,
            "version-1",
          );

        const error =
          new SaveNoteVersionRequestError({
            status: 409,
            code: "version_conflict",
            message:
              "The note was updated elsewhere.",
            currentVersion,
            commonAncestor: null,
          });

        expect(
          getNoteAutosaveConflict(error),
        ).toEqual({
          message:
            "The note was updated elsewhere.",
          currentVersion,
          commonAncestor: null,
        });
      },
    );

    it(
      "returns null for a normal save failure",
      () => {
        const error =
          new SaveNoteVersionRequestError({
            status: 500,
            code: "internal_error",
            message:
              "The save failed.",
          });

        expect(
          getNoteAutosaveConflict(error),
        ).toBeNull();
      },
    );
  },
);