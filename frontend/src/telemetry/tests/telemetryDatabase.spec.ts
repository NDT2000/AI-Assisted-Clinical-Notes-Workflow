import "fake-indexeddb/auto";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  IndexedDbTelemetryPersistence,
} from "../telemetryDatabase";

describe(
  "IndexedDbTelemetryPersistence",
  () => {
    it(
      "adds, reads, counts, and removes parked telemetry batches",
      async () => {
        const persistence =
          new IndexedDbTelemetryPersistence();

        const initialCount =
          await persistence.count();

        const id =
          await persistence.add({
            createdAt:
              "2026-08-02T16:00:00.000Z",
            attemptCount: 3,
            events: [
              {
                eventId:
                  "telemetry-event-1",
                name:
                  "note.version_save",
                occurredAt:
                  "2026-08-02T16:00:00.000Z",
                important: false,
                properties: {
                  outcome:
                    "failure",
                },
              },
            ],
          });

        expect(id).not.toBeNull();

        expect(
          await persistence.count(),
        ).toBe(
          initialCount + 1,
        );

        const oldest =
          await persistence.getOldest();

        expect(oldest).not.toBeNull();

        expect(
          oldest?.id,
        ).toEqual(
          expect.any(Number),
        );

        if (
          oldest?.id ===
          undefined
        ) {
          throw new Error(
            "Expected the parked batch to have an IndexedDB key.",
          );
        }

        await persistence.remove(
          oldest.id,
        );

        expect(
          await persistence.count(),
        ).toBe(initialCount);
      },
    );
  },
);
