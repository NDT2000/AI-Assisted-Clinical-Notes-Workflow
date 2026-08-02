import type {
  SaveNoteVersionActor,
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";

import {
  SaveNoteVersionRequestError,
  saveNoteVersion,
} from "../api/saveNoteVersion";

import {
  queueLatestSaveForNote,
  type PersistedQueuedNoteVersionSave,
} from "./offlineRepository";

import {
  offlineSaveReplayCoordinator,
} from "./offlineSaveReplay";

export type OfflineAwareSaveResult =
  | {
      kind: "saved";
      response: SaveNoteVersionResponse;
    }
  | {
      kind: "queued";
      entry: PersistedQueuedNoteVersionSave;
    };

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
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
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

async function queueSave(
  noteId: string,
  actor: SaveNoteVersionActor,
  request: SaveNoteVersionRequestBody,
): Promise<OfflineAwareSaveResult> {
  const entry =
    await queueLatestSaveForNote({
      noteId,

      actor: {
        ...actor,
      },

      request: {
        ...request,
        content: {
          ...request.content,
        },
      },
    });

  offlineSaveReplayCoordinator
    .notifyQueueChanged();

  return {
    kind: "queued",
    entry,
  };
}

export async function saveNoteVersionWithOfflineQueue(
  noteId: string,
  actor: SaveNoteVersionActor,
  request: SaveNoteVersionRequestBody,
  signal?: AbortSignal,
): Promise<OfflineAwareSaveResult> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  if (browserReportsOffline()) {
    return queueSave(
      noteId,
      actor,
      request,
    );
  }

  try {
    const response =
      await saveNoteVersion(
        noteId,
        actor,
        request,
        signal,
      );

    return {
      kind: "saved",
      response,
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
      SaveNoteVersionRequestError
    ) {
      throw error;
    }

    if (
      browserReportsOffline() ||
      isNetworkFailure(error)
    ) {
      return queueSave(
        noteId,
        actor,
        request,
      );
    }

    throw error;
  }
}