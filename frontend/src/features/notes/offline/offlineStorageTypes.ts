import type {
  NoteDetail,
  NoteVersionDetail,
} from "../../../domain/noteDetail";

import type {
  SaveNoteVersionActor,
  SaveNoteVersionRequestBody,
} from "../../../domain/noteSave";

export type OfflineMutationState =
  | "queued"
  | "blocked-conflict";

export interface OfflineSaveConflict {
  message: string;
  currentVersion: NoteVersionDetail;
  commonAncestor: NoteVersionDetail | null;
}

export interface QueuedNoteVersionSave {
  sequence?: number;

  kind: "save-note-version";

  noteId: string;

  actor: SaveNoteVersionActor;

  request: SaveNoteVersionRequestBody;

  queuedAt: number;

  state: OfflineMutationState;

  retryCount: number;

  lastAttemptAt: number | null;

  lastError: string | null;

  conflict: OfflineSaveConflict | null;
}

export interface CachedNoteDetailRecord {
  noteId: string;

  detail: NoteDetail;

  cachedAt: number;
}