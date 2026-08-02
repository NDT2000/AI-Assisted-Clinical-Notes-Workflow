import type { NoteDetail } from "../../../domain/noteDetail";

import {
  getOfflineDatabase,
  NOTE_DETAIL_CACHE_STORE,
  NOTE_VERSION_SAVE_QUEUE_STORE,
} from "./offlineDatabase";

import type {
  CachedNoteDetailRecord,
  OfflineSaveConflict,
  QueuedNoteVersionSave,
} from "./offlineStorageTypes";

export const MAX_CACHED_NOTE_DETAILS = 20;

export type PersistedQueuedNoteVersionSave =
  QueuedNoteVersionSave & {
    sequence: number;
  };

export interface EnqueueNoteVersionSaveInput {
  noteId: QueuedNoteVersionSave["noteId"];
  actor: QueuedNoteVersionSave["actor"];
  request: QueuedNoteVersionSave["request"];
  queuedAt?: number;
}

export interface QueueLatestNoteVersionSaveInput {
  noteId: QueuedNoteVersionSave["noteId"];
  actor: QueuedNoteVersionSave["actor"];
  request: QueuedNoteVersionSave["request"];
  queuedAt?: number;
}

export interface ReplaceBlockedSaveWithResolutionInput {
  sequence: number;
  request: QueuedNoteVersionSave["request"];
  queuedAt?: number;
}

function requirePersistedSequence(
  entry: QueuedNoteVersionSave,
): PersistedQueuedNoteVersionSave {
  if (typeof entry.sequence !== "number") {
    throw new Error(
      "Persisted queue entry is missing its IndexedDB sequence.",
    );
  }

  return entry as PersistedQueuedNoteVersionSave;
}

export async function enqueueSave(
  input: EnqueueNoteVersionSaveInput,
): Promise<PersistedQueuedNoteVersionSave> {
  const database = await getOfflineDatabase();

  const entry: QueuedNoteVersionSave = {
    kind: "save-note-version",

    noteId: input.noteId,
    actor: input.actor,
    request: input.request,

    queuedAt: input.queuedAt ?? Date.now(),

    state: "queued",

    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,

    conflict: null,
  };

  const sequence = await database.add(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    entry,
  );

  return {
    ...entry,
    sequence,
  };
}

export async function queueLatestSaveForNote(
  input: QueueLatestNoteVersionSaveInput,
): Promise<PersistedQueuedNoteVersionSave> {
  const database = await getOfflineDatabase();

  const transaction = database.transaction(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    "readwrite",
  );

  const noteIndex =
    transaction.store.index("by-note-id");

  let cursor = await noteIndex.openCursor(
    input.noteId,
  );

  let existingQueuedEntry:
    | QueuedNoteVersionSave
    | null = null;

  while (cursor !== null) {
    if (cursor.value.state === "queued") {
      existingQueuedEntry = cursor.value;
      break;
    }

    cursor = await cursor.continue();
  }

  if (existingQueuedEntry !== null) {
    const sequence =
      existingQueuedEntry.sequence;

    if (typeof sequence !== "number") {
      throw new Error(
        "Persisted queue entry is missing its IndexedDB sequence.",
      );
    }

    const updated: QueuedNoteVersionSave = {
      ...existingQueuedEntry,

      actor: input.actor,
      request: input.request,

      queuedAt:
        input.queuedAt ?? Date.now(),

      retryCount: 0,
      lastAttemptAt: null,
      lastError: null,
      conflict: null,
    };

    await transaction.store.put(updated);
    await transaction.done;

    return {
      ...updated,
      sequence,
    };
  }

  const entry: QueuedNoteVersionSave = {
    kind: "save-note-version",

    noteId: input.noteId,
    actor: input.actor,
    request: input.request,

    queuedAt:
      input.queuedAt ?? Date.now(),

    state: "queued",

    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    conflict: null,
  };

  const sequence =
    await transaction.store.add(entry);

  await transaction.done;

  return {
    ...entry,
    sequence,
  };
}

export async function getQueuedSaves(): Promise<
  PersistedQueuedNoteVersionSave[]
> {
  const database = await getOfflineDatabase();

  const entries = await database.getAll(
    NOTE_VERSION_SAVE_QUEUE_STORE,
  );

  return entries
    .map(requirePersistedSequence)
    .sort(
      (left, right) =>
        left.sequence - right.sequence,
    );
}

export async function getOldestQueuedSave(): Promise<
  PersistedQueuedNoteVersionSave | null
> {
  const database = await getOfflineDatabase();

  const cursor = await database
    .transaction(
      NOTE_VERSION_SAVE_QUEUE_STORE,
      "readonly",
    )
    .store.index("by-state")
    .openCursor("queued");

  if (cursor === null) {
    return null;
  }

  return requirePersistedSequence(cursor.value);
}

export async function removeQueuedSave(
  sequence: number,
): Promise<void> {
  const database = await getOfflineDatabase();

  await database.delete(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    sequence,
  );
}

export async function recordSaveAttemptFailure(
  sequence: number,
  errorMessage: string,
  attemptedAt = Date.now(),
): Promise<PersistedQueuedNoteVersionSave | null> {
  const database = await getOfflineDatabase();

  const transaction = database.transaction(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    "readwrite",
  );

  const existing =
    await transaction.store.get(sequence);

  if (existing === undefined) {
    await transaction.done;
    return null;
  }

  const updated: QueuedNoteVersionSave = {
    ...existing,

    state: "queued",

    retryCount: existing.retryCount + 1,
    lastAttemptAt: attemptedAt,
    lastError: errorMessage,
  };

  await transaction.store.put(updated);
  await transaction.done;

  return requirePersistedSequence(updated);
}

export async function markSaveConflict(
  sequence: number,
  conflict: OfflineSaveConflict,
  attemptedAt = Date.now(),
): Promise<PersistedQueuedNoteVersionSave | null> {
  const database = await getOfflineDatabase();

  const transaction = database.transaction(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    "readwrite",
  );

  const existing =
    await transaction.store.get(sequence);

  if (existing === undefined) {
    await transaction.done;
    return null;
  }

  const updated: QueuedNoteVersionSave = {
    ...existing,

    state: "blocked-conflict",

    lastAttemptAt: attemptedAt,
    lastError: conflict.message,
    conflict,
  };

  await transaction.store.put(updated);
  await transaction.done;

  return requirePersistedSequence(updated);
}

export async function replaceBlockedSaveWithResolution(
  input: ReplaceBlockedSaveWithResolutionInput,
): Promise<PersistedQueuedNoteVersionSave | null> {
  const database = await getOfflineDatabase();

  const transaction = database.transaction(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    "readwrite",
  );

  const existing =
    await transaction.store.get(
      input.sequence,
    );

  if (
    existing === undefined ||
    existing.state !== "blocked-conflict"
  ) {
    await transaction.done;
    return null;
  }

  const updated: QueuedNoteVersionSave = {
    ...existing,

    request: {
      ...input.request,
      content: {
        ...input.request.content,
      },
    },

    queuedAt:
      input.queuedAt ?? Date.now(),

    state: "queued",
    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    conflict: null,
  };

  await transaction.store.put(updated);
  await transaction.done;

  return requirePersistedSequence(updated);
}

export async function countQueuedSaves(): Promise<number> {
  const database = await getOfflineDatabase();

  return database.count(
    NOTE_VERSION_SAVE_QUEUE_STORE,
  );
}

export async function countReplayableSaves(): Promise<number> {
  const database = await getOfflineDatabase();

  return database.countFromIndex(
    NOTE_VERSION_SAVE_QUEUE_STORE,
    "by-state",
    "queued",
  );
}

export async function cacheNoteDetail(
  detail: NoteDetail,
  cachedAt = Date.now(),
): Promise<CachedNoteDetailRecord> {
  const database = await getOfflineDatabase();

  const record: CachedNoteDetailRecord = {
    noteId: detail.note.id,
    detail,
    cachedAt,
  };

  const transaction = database.transaction(
    NOTE_DETAIL_CACHE_STORE,
    "readwrite",
  );

  await transaction.store.put(record);

  const cacheCount =
    await transaction.store.count();

  let entriesToRemove =
    cacheCount - MAX_CACHED_NOTE_DETAILS;

  if (entriesToRemove > 0) {
    let cursor = await transaction.store
      .index("by-cached-at")
      .openCursor();

    while (
      cursor !== null &&
      entriesToRemove > 0
    ) {
      await cursor.delete();

      entriesToRemove -= 1;
      cursor = await cursor.continue();
    }
  }

  await transaction.done;

  return record;
}

export async function getCachedNoteDetailRecord(
  noteId: string,
): Promise<CachedNoteDetailRecord | null> {
  const database = await getOfflineDatabase();

  const record = await database.get(
    NOTE_DETAIL_CACHE_STORE,
    noteId,
  );

  return record ?? null;
}

export async function getCachedNoteDetail(
  noteId: string,
): Promise<NoteDetail | null> {
  const record =
    await getCachedNoteDetailRecord(noteId);

  return record?.detail ?? null;
}

export async function removeCachedNoteDetail(
  noteId: string,
): Promise<void> {
  const database = await getOfflineDatabase();

  await database.delete(
    NOTE_DETAIL_CACHE_STORE,
    noteId,
  );
}

export async function countCachedNoteDetails(): Promise<number> {
  const database = await getOfflineDatabase();

  return database.count(
    NOTE_DETAIL_CACHE_STORE,
  );
}

export async function clearOfflineStorage(): Promise<void> {
  const database = await getOfflineDatabase();

  const transaction = database.transaction(
    [
      NOTE_VERSION_SAVE_QUEUE_STORE,
      NOTE_DETAIL_CACHE_STORE,
    ],
    "readwrite",
  );

  await transaction
    .objectStore(NOTE_VERSION_SAVE_QUEUE_STORE)
    .clear();

  await transaction
    .objectStore(NOTE_DETAIL_CACHE_STORE)
    .clear();

  await transaction.done;
}