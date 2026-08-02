import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
} from "idb";

import type {
  PersistedTelemetryBatch,
  TelemetryPersistence,
} from "./telemetryTypes";

const TELEMETRY_DATABASE_NAME =
  "clinical-notes-telemetry";

const TELEMETRY_DATABASE_VERSION =
  1;

const TELEMETRY_BATCH_STORE =
  "telemetry-batches";

interface TelemetryDatabaseSchema
  extends DBSchema {
  "telemetry-batches": {
    key: number;
    value:
      PersistedTelemetryBatch & {
        id: number;
      };
    indexes: {
      "by-created-at": string;
    };
  };
}

let databasePromise:
  | Promise<
      IDBPDatabase<
        TelemetryDatabaseSchema
      >
    >
  | null = null;

function canUseIndexedDb(): boolean {
  return (
    typeof indexedDB !==
    "undefined"
  );
}

function getDatabase():
  Promise<
    IDBPDatabase<
      TelemetryDatabaseSchema
    >
  > {
  if (!canUseIndexedDb()) {
    return Promise.reject(
      new Error(
        "IndexedDB is unavailable.",
      ),
    );
  }

  if (
    databasePromise === null
  ) {
    databasePromise = openDB<
      TelemetryDatabaseSchema
    >(
      TELEMETRY_DATABASE_NAME,
      TELEMETRY_DATABASE_VERSION,
      {
        upgrade(database) {
          const store =
            database.createObjectStore(
              TELEMETRY_BATCH_STORE,
              {
                keyPath: "id",
                autoIncrement: true,
              },
            );

          store.createIndex(
            "by-created-at",
            "createdAt",
          );
        },
      },
    );
  }

  return databasePromise;
}

export class IndexedDbTelemetryPersistence
  implements
    TelemetryPersistence {
  async add(
    batch:
      PersistedTelemetryBatch,
  ): Promise<number | null> {
    if (!canUseIndexedDb()) {
      return null;
    }

    const database =
      await getDatabase();

    return database.add(
      TELEMETRY_BATCH_STORE,
      batch as PersistedTelemetryBatch & {
        id: number;
      },
    );
  }

  async getOldest():
    Promise<
      PersistedTelemetryBatch | null
    > {
    if (!canUseIndexedDb()) {
      return null;
    }

    const database =
      await getDatabase();

    const transaction =
      database.transaction(
        TELEMETRY_BATCH_STORE,
        "readonly",
      );

    const index =
      transaction.store.index(
        "by-created-at",
      );

    const cursor =
      await index.openCursor();

    await transaction.done;

    return cursor?.value ?? null;
  }

  async remove(
    id: number,
  ): Promise<void> {
    if (!canUseIndexedDb()) {
      return;
    }

    const database =
      await getDatabase();

    await database.delete(
      TELEMETRY_BATCH_STORE,
      id,
    );
  }

  async count(): Promise<number> {
    if (!canUseIndexedDb()) {
      return 0;
    }

    const database =
      await getDatabase();

    return database.count(
      TELEMETRY_BATCH_STORE,
    );
  }
}

export const telemetryPersistence =
  new IndexedDbTelemetryPersistence();