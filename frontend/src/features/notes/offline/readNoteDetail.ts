import type { UserRole } from "../../../domain/noteAttributes";
import type { NoteDetail } from "../../../domain/noteDetail";

import {
  getNoteDetail,
  NoteDetailRequestError,
} from "../api/getNoteDetail";

import {
  cacheNoteDetail,
  getCachedNoteDetailRecord,
} from "./offlineRepository";

export type NoteDetailReadSource =
  | "network"
  | "cache";

export interface NoteDetailReadResult {
  note: NoteDetail;

  source: NoteDetailReadSource;

  cachedAt: number | null;
}

export class OfflineNoteDetailUnavailableError
  extends Error {
  readonly noteId: string;

  constructor(noteId: string) {
    super(
      "This note is not available offline because it has not been opened recently.",
    );

    this.name =
      "OfflineNoteDetailUnavailableError";

    this.noteId = noteId;
  }
}

function browserReportsOffline(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  );
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function isNetworkFailure(
  error: unknown,
): boolean {
  return error instanceof TypeError;
}

function createAbortError(): DOMException {
  return new DOMException(
    "The operation was aborted.",
    "AbortError",
  );
}

async function readCachedNote(
  noteId: string,
): Promise<NoteDetailReadResult> {
  const cachedRecord =
    await getCachedNoteDetailRecord(noteId);

  if (cachedRecord === null) {
    throw new OfflineNoteDetailUnavailableError(
      noteId,
    );
  }

  return {
    note: cachedRecord.detail,
    source: "cache",
    cachedAt: cachedRecord.cachedAt,
  };
}

export async function readNoteDetail(
  noteId: string,
  actorRole: UserRole,
  signal?: AbortSignal,
): Promise<NoteDetailReadResult> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  if (browserReportsOffline()) {
    return readCachedNote(noteId);
  }

  try {
    const note = await getNoteDetail(
      noteId,
      actorRole,
      signal,
    );

    if (signal?.aborted) {
      throw createAbortError();
    }

    try {
      await cacheNoteDetail(note);
    } catch {
    }

    return {
      note,
      source: "network",
      cachedAt: null,
    };
  } catch (error) {
    if (
      signal?.aborted ||
      isAbortError(error)
    ) {
      throw error;
    }

    if (
      error instanceof
      NoteDetailRequestError
    ) {
      throw error;
    }

    if (
      browserReportsOffline() ||
      isNetworkFailure(error)
    ) {
      return readCachedNote(noteId);
    }

    throw error;
  }
}