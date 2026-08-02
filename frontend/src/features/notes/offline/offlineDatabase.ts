import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
} from "idb";

import type {
  CachedNoteDetailRecord,
  OfflineMutationState,
  QueuedNoteVersionSave,
} from "./offlineStorageTypes";

export const OFFLINE_DATABASE_NAME =
  "ai-clinical-notes-offline";

export const OFFLINE_DATABASE_VERSION = 2;

export const NOTE_VERSION_SAVE_QUEUE_STORE =
  "note-version-save-queue";

export const NOTE_DETAIL_CACHE_STORE =
  "note-detail-cache";

export interface ClinicalNotesOfflineDatabase
  extends DBSchema {
  "note-version-save-queue": {
    key: number;
    value: QueuedNoteVersionSave;
    indexes: {
      "by-state": OfflineMutationState;
      "by-note-id": string;
    };
  };

  "note-detail-cache": {
    key: string;
    value: CachedNoteDetailRecord;
    indexes: {
      "by-cached-at": number;
    };
  };
}

let databasePromise:
  | Promise<
      IDBPDatabase<ClinicalNotesOfflineDatabase>
    >
  | null = null;

export function getOfflineDatabase(): Promise<
  IDBPDatabase<ClinicalNotesOfflineDatabase>
> {
  if (databasePromise === null) {
    databasePromise =
      openDB<ClinicalNotesOfflineDatabase>(
        OFFLINE_DATABASE_NAME,
        OFFLINE_DATABASE_VERSION,
        {
          upgrade(
            database,
            oldVersion,
            _newVersion,
            transaction,
          ) {
            if (
              !database.objectStoreNames.contains(
                NOTE_VERSION_SAVE_QUEUE_STORE,
              )
            ) {
              const queueStore =
                database.createObjectStore(
                  NOTE_VERSION_SAVE_QUEUE_STORE,
                  {
                    keyPath: "sequence",
                    autoIncrement: true,
                  },
                );

              queueStore.createIndex(
                "by-state",
                "state",
              );

              queueStore.createIndex(
                "by-note-id",
                "noteId",
              );
            } else if (oldVersion < 2) {
              const queueStore =
                transaction.objectStore(
                  NOTE_VERSION_SAVE_QUEUE_STORE,
                );

              if (
                !queueStore.indexNames.contains(
                  "by-note-id",
                )
              ) {
                queueStore.createIndex(
                  "by-note-id",
                  "noteId",
                );
              }
            }

            if (
              !database.objectStoreNames.contains(
                NOTE_DETAIL_CACHE_STORE,
              )
            ) {
              const cacheStore =
                database.createObjectStore(
                  NOTE_DETAIL_CACHE_STORE,
                  {
                    keyPath: "noteId",
                  },
                );

              cacheStore.createIndex(
                "by-cached-at",
                "cachedAt",
              );
            }
          },
        },
      );
  }

  return databasePromise;
}

export async function resetOfflineDatabaseForTests(): Promise<void> {
  const existingPromise = databasePromise;

  databasePromise = null;

  if (existingPromise !== null) {
    try {
      const database = await existingPromise;
      database.close();
    } catch {
    }
  }

  await deleteDB(OFFLINE_DATABASE_NAME);
}