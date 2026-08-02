import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  TelemetryClient,
} from "../TelemetryClient";
import type {
  PersistedTelemetryBatch,
  TelemetryBatch,
  TelemetryPersistence,
  TelemetryTransport,
} from "../telemetryTypes";

class MemoryTelemetryPersistence
  implements
    TelemetryPersistence {
  private nextId = 1;

  readonly batches:
    Array<
      PersistedTelemetryBatch & {
        id: number;
      }
    > = [];

  async add(
    batch:
      PersistedTelemetryBatch,
  ): Promise<number> {
    const id = this.nextId;

    this.nextId += 1;

    this.batches.push({
      ...batch,
      id,
    });

    return id;
  }

  async getOldest():
    Promise<
      PersistedTelemetryBatch | null
    > {
    return (
      this.batches[0] ??
      null
    );
  }

  async remove(
    id: number,
  ): Promise<void> {
    const index =
      this.batches.findIndex(
        batch =>
          batch.id === id,
      );

    if (index >= 0) {
      this.batches.splice(
        index,
        1,
      );
    }
  }

  async count(): Promise<number> {
    return this.batches.length;
  }
}

class ManualTelemetryTimers {
  private nextId = 1;

  private readonly intervalCallbacks =
    new Map<
      number,
      () => void
    >();

  private readonly timeoutCallbacks =
    new Map<
      number,
      () => void
    >();

  readonly timeoutDelays:
    number[] = [];

  setInterval = (
    callback: () => void,
    _delayMs: number,
  ):
    ReturnType<
      typeof setInterval
    > => {
    const id = this.nextId;

    this.nextId += 1;

    this.intervalCallbacks.set(
      id,
      callback,
    );

    return id as unknown as
      ReturnType<
        typeof setInterval
      >;
  };

  clearInterval = (
    timer:
      ReturnType<
        typeof setInterval
      >,
  ): void => {
    this.intervalCallbacks.delete(
      timer as unknown as number,
    );
  };

  setTimeout = (
    callback: () => void,
    delayMs: number,
  ):
    ReturnType<
      typeof setTimeout
    > => {
    const id = this.nextId;

    this.nextId += 1;

    this.timeoutCallbacks.set(
      id,
      callback,
    );

    this.timeoutDelays.push(
      delayMs,
    );

    return id as unknown as
      ReturnType<
        typeof setTimeout
      >;
  };

  clearTimeout = (
    timer:
      ReturnType<
        typeof setTimeout
      >,
  ): void => {
    this.timeoutCallbacks.delete(
      timer as unknown as number,
    );
  };

  runInterval(): void {
    const callback = [
      ...this.intervalCallbacks
        .values(),
    ][0];

    if (callback === undefined) {
      throw new Error(
        "Expected an interval callback.",
      );
    }

    callback();
  }

  runNextTimeout(): void {
    const entry = [
      ...this.timeoutCallbacks
        .entries(),
    ][0];

    if (entry === undefined) {
      throw new Error(
        "Expected a timeout callback.",
      );
    }

    const [
      id,
      callback,
    ] = entry;

    this.timeoutCallbacks.delete(
      id,
    );

    callback();
  }
}

function createRecordingTransport() {
  const batches:
    TelemetryBatch[] = [];

  const send = vi.fn(
    async (
      batch: TelemetryBatch,
    ) => {
      batches.push(batch);
    },
  );

  const transport:
    TelemetryTransport = {
    send,
  };

  return {
    batches,
    send,
    transport,
  };
}

function createClientOptions(
  transport:
    TelemetryTransport,
  persistence:
    TelemetryPersistence,
  timers:
    ManualTelemetryTimers,
) {
  let eventNumber = 1;

  return {
    transport,
    persistence,
    batchSize: 2,
    flushIntervalMs: 1_000,
    maxSendAttempts: 3,
    baseRetryDelayMs: 100,
    maxRetryDelayMs: 1_000,
    now: () =>
      "2026-08-02T16:00:00.000Z",
    createEventId: () => {
      const id =
        `telemetry-event-${eventNumber}`;

      eventNumber += 1;

      return id;
    },
    random: () => 0,
    sleep:
      vi.fn(
        async () =>
          undefined,
      ),
    timers: {
      setInterval:
        timers.setInterval,
      clearInterval:
        timers.clearInterval,
      setTimeout:
        timers.setTimeout,
      clearTimeout:
        timers.clearTimeout,
    },
  };
}

describe(
  "TelemetryClient",
  () => {
    it(
      "flushes when the configured batch size is reached",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const recording =
          createRecordingTransport();

        const client =
          new TelemetryClient(
            createClientOptions(
              recording.transport,
              persistence,
              timers,
            ),
          );

        client.start();

        await client.flush(
          "startup",
        );

        client.track(
          "note.version_save",
          {
            outcome: "success",
          },
        );

        client.track(
          "note.status_transition",
          {
            outcome: "success",
          },
        );

        await vi.waitFor(() => {
          expect(
            recording.send,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        expect(
          recording.batches[0]
            ?.reason,
        ).toBe("size");

        expect(
          recording.batches[0]
            ?.events,
        ).toHaveLength(2);

        client.stop();
      },
    );

    it(
      "flushes queued events on the time interval",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const recording =
          createRecordingTransport();

        const client =
          new TelemetryClient(
            createClientOptions(
              recording.transport,
              persistence,
              timers,
            ),
          );

        client.start();

        await client.flush(
          "startup",
        );

        client.track(
          "navigation.route_view",
          {
            route: "/notes",
          },
        );

        expect(
          recording.send,
        ).not.toHaveBeenCalled();

        timers.runInterval();

        await vi.waitFor(() => {
          expect(
            recording.send,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        expect(
          recording.batches[0]
            ?.reason,
        ).toBe("time");

        client.stop();
      },
    );

    it(
      "flushes an important event immediately after startup has completed",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const recording =
          createRecordingTransport();

        const client =
          new TelemetryClient(
            createClientOptions(
              recording.transport,
              persistence,
              timers,
            ),
          );

        client.start();

        await client.flush(
          "startup",
        );

        client.track(
          "application.failure",
          {
            outcome: "failure",
          },
          {
            important: true,
          },
        );

        await vi.waitFor(() => {
          expect(
            recording.send,
          ).toHaveBeenCalledTimes(
            1,
          );
        });

        expect(
          recording.batches[0]
            ?.reason,
        ).toBe("important");

        expect(
          recording.batches[0]
            ?.events[0]
            ?.important,
        ).toBe(true);

        client.stop();
      },
    );

    it(
      "redacts SOAP content and patient information before transmission",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const recording =
          createRecordingTransport();

        const client =
          new TelemetryClient(
            createClientOptions(
              recording.transport,
              persistence,
              timers,
            ),
          );

        client.track(
          "note.version_save",
          {
            status:
              "IN_REVIEW",
            role: "REVIEWER",
            route:
              "/notes/note-secret?patient=Alice",
            subjective:
              "Patient reports severe pain.",
            objective:
              "Blood pressure is elevated.",
            assessment:
              "Possible hypertension.",
            plan:
              "Continue medication.",
            patientId:
              "patient-secret",
            patientName:
              "Alice Example",
            medicalRecordNumber:
              "MRN-SECRET",
            contentPreview:
              "Sensitive clinical preview",
            patient: {
              displayName:
                "Alice Example",
            },
            soapContent: {
              subjective:
                "Sensitive content",
            },
          },
        );

        await client.flush(
          "manual",
        );

        expect(
          recording.send,
        ).toHaveBeenCalledTimes(
          1,
        );

        const batch =
          recording.batches[0];

        expect(
          batch?.events[0]
            ?.properties,
        ).toEqual({
          status:
            "IN_REVIEW",
          role: "REVIEWER",
          route:
            "/notes/:noteId",
        });

        const serialized =
          JSON.stringify(batch);

        expect(serialized).not.toContain(
          "Patient reports",
        );

        expect(serialized).not.toContain(
          "Alice Example",
        );

        expect(serialized).not.toContain(
          "MRN-SECRET",
        );

        expect(serialized).not.toContain(
          "note-secret",
        );
      },
    );

    it(
      "retries with exponential backoff before succeeding",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        let attempts = 0;

        const send = vi.fn(
          async () => {
            attempts += 1;

            if (attempts < 3) {
              throw new Error(
                "Temporary failure.",
              );
            }
          },
        );

        const sleep = vi.fn(
          async (
            _delayMs: number,
          ) =>
            undefined,
        );

        const client =
          new TelemetryClient({
            ...createClientOptions(
              {
                send,
              },
              persistence,
              timers,
            ),
            sleep,
          });

        client.track(
          "note.version_save",
          {
            outcome: "success",
          },
        );

        await client.flush(
          "manual",
        );

        expect(send).toHaveBeenCalledTimes(
          3,
        );

        expect(
          sleep.mock.calls.map(
            call => call[0],
          ),
        ).toEqual([
          100,
          200,
        ]);

        expect(
          await persistence.count(),
        ).toBe(0);
      },
    );

    it(
      "parks a batch after repeated delivery failure",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const send = vi.fn(
          async () => {
            throw new Error(
              "Delivery failed.",
            );
          },
        );

        const client =
          new TelemetryClient({
            ...createClientOptions(
              {
                send,
              },
              persistence,
              timers,
            ),
            maxSendAttempts: 2,
          });

        client.track(
          "note.version_save",
          {
            outcome: "failure",
            patientId:
              "patient-secret",
            subjective:
              "Sensitive clinical content",
          },
        );

        await client.flush(
          "manual",
        );

        expect(send).toHaveBeenCalledTimes(
          2,
        );

        expect(
          await persistence.count(),
        ).toBe(1);

        expect(
          persistence.batches[0]
            ?.events[0]
            ?.properties,
        ).toEqual({
          outcome: "failure",
        });

        expect(
          client.getSnapshot(),
        ).toMatchObject({
          queuedEventCount: 0,
          retryAttempt: 1,
          nextRetryDelayMs: 100,
        });

        client.stop();
      },
    );

    it(
      "replays and removes the oldest persisted batch",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        await persistence.add({
          createdAt:
            "2026-08-02T15:00:00.000Z",
          attemptCount: 3,
          events: [
            {
              eventId:
                "persisted-event-1",
              name:
                "note.version_save",
              occurredAt:
                "2026-08-02T15:00:00.000Z",
              important: false,
              properties: {
                outcome:
                  "success",
              },
            },
          ],
        });

        const recording =
          createRecordingTransport();

        const client =
          new TelemetryClient(
            createClientOptions(
              recording.transport,
              persistence,
              timers,
            ),
          );

        await client.flush(
          "startup",
        );

        expect(
          recording.send,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recording.batches[0]
            ?.events[0]
            ?.eventId,
        ).toBe(
          "persisted-event-1",
        );

        expect(
          await persistence.count(),
        ).toBe(0);
      },
    );

    it(
      "uses unload delivery and removes the in-memory events",
      async () => {
        const timers =
          new ManualTelemetryTimers();

        const persistence =
          new MemoryTelemetryPersistence();

        const send = vi.fn(
          async () =>
            undefined,
        );

        const client =
          new TelemetryClient(
            createClientOptions(
              {
                send,
              },
              persistence,
              timers,
            ),
          );

        client.track(
          "navigation.route_change",
          {
            route: "/notes",
          },
        );

        await client.flushOnUnload();

        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            reason:
              "page-unload",
          }),
          {
            unload: true,
          },
        );

        expect(
          client.getSnapshot()
            .queuedEventCount,
        ).toBe(0);
      },
    );
  },
);