import type { NoteVersionDetail, } from "../../../domain/noteDetail";
import { SaveNoteVersionRequestError, } from "../api/saveNoteVersion";

export interface NoteAutosaveConflict {
  message: string;
  currentVersion: NoteVersionDetail;
  commonAncestor:
    | NoteVersionDetail
    | null;
}

export function getNoteAutosaveConflict(
  error: unknown,
): NoteAutosaveConflict | null {
  if (
    !(
      error instanceof
      SaveNoteVersionRequestError
    ) ||
    error.code !== "version_conflict" ||
    error.currentVersion === undefined
  ) {
    return null;
  }

  return {
    message: error.message,
    currentVersion:
      error.currentVersion,
    commonAncestor:
      error.commonAncestor ?? null,
  };
}