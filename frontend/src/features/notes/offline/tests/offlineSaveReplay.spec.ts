import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SaveNoteVersionResponse } from "../../../../domain/noteSave";

import type {
  PersistedQueuedNoteVersionSave,
} from "../offlineRepository";

import {
  OfflineSaveReplayCoordinator,
  type OfflineSaveReplayDependencies,
} from "../offlineSaveReplay";

class TestEventTarget {
  private readonly listeners = {
    online: new Set<EventListener>(),
    offline: new Set<EventListener>(),
  };

  addEventListener(
    type: "online" | "offline",
    listener: EventListener,
  ): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(
    type: "online" | "offline",
    listener: EventListener,
  ): void {
    this.listeners[type].delete(listener);
  }

  dispatch(
    type: "online" | "offline",
  ): void {
    const event = new Event(type);

    for (
      const listener of
      this.listeners[type]
    ) {
      listener(event);
    }
  }

  listenerCount(
    type: "online" | "offline",
  ): number {
    return this.listeners[type].size;
  }
}

function createEntry(
  sequence: number,
): PersistedQueuedNoteVersionSave {
  return {
    sequence,
    kind: "save-note-version",
    noteId: `note-${sequence}`,

    actor: {
      id: "reviewer-1",
      displayName: "Reviewer One",
      role: "REVIEWER",
    },

    request: {
      baseVersionId:
        `version-${sequence}`,

      clientMutationId:
        `mutation-${sequence}`,

      content: {
        subjective: `Subjective ${sequence}`,
        objective: `Objective ${sequence}`,
        assessment: `Assessment ${sequence}`,
        plan: `Plan ${sequence}`,
      },
    },

    queuedAt: sequence,
    state: "queued",
    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    conflict: null,
  };
}

function createSaveResponse(
  entry: PersistedQueuedNoteVersionSave,
): SaveNoteVersionResponse {
  return {
    clientMutationId:
      entry.request.clientMutationId,
  } as SaveNoteVersionResponse;
}

function createDependencies(
  overrides: Partial<OfflineSaveReplayDependencies> = {},
): OfflineSaveReplayDependencies {
  return {
    getOldestQueuedSave:
      async () => null,

    removeQueuedSave:
      async () => undefined,

    recordSaveAttemptFailure:
      async () => null,

    saveNoteVersion:
      async (
        _noteId,
        _actor,
        request,
      ) =>
        ({
          clientMutationId:
            request.clientMutationId,
        }) as SaveNoteVersionResponse,

    isOnline: () => true,

    eventTarget: null,

    ...overrides,
  };
}

describe(
  "OfflineSaveReplayCoordinator",
  () => {
    it(
      "replays queued saves in FIFO order",
      async () => {
        const entries = [
          createEntry(1),
          createEntry(2),
          createEntry(3),
        ];

        const replayedSequences:
          number[] = [];

        const removedSequences:
          number[] = [];

        let activeSaveCount = 0;
        let maximumActiveSaveCount = 0;

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () =>
                  entries[0] ?? null,

              saveNoteVersion:
                async () => {
                  const entry =
                    entries[0];

                  if (entry === undefined) {
                    throw new Error(
                      "Expected a queued entry.",
                    );
                  }

                  activeSaveCount += 1;

                  maximumActiveSaveCount =
                    Math.max(
                      maximumActiveSaveCount,
                      activeSaveCount,
                    );

                  replayedSequences.push(
                    entry.sequence,
                  );

                  await Promise.resolve();

                  activeSaveCount -= 1;

                  return createSaveResponse(
                    entry,
                  );
                },

              removeQueuedSave:
                async sequence => {
                  removedSequences.push(
                    sequence,
                  );

                  const entry =
                    entries[0];

                  expect(
                    entry?.sequence,
                  ).toBe(sequence);

                  entries.shift();
                },
            }),
          );

        await coordinator.replay();

        expect(
          replayedSequences,
        ).toEqual([1, 2, 3]);

        expect(
          removedSequences,
        ).toEqual([1, 2, 3]);

        expect(
          maximumActiveSaveCount,
        ).toBe(1);

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "idle",
          currentSequence: null,
          replayedCount: 3,
          lastError: null,
        });
      },
    );

    it(
      "does not start concurrent replay loops",
      async () => {
        const entry = createEntry(1);

        let currentEntry:
          | PersistedQueuedNoteVersionSave
          | null = entry;

        let releaseSave:
          () => void = () => undefined;

        const saveGate =
          new Promise<void>(resolve => {
            releaseSave = () => {
              resolve();
            };
          });

        const saveNoteVersionMock =
          vi.fn(
            async () => {
              await saveGate;

              return createSaveResponse(
                entry,
              );
            },
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () =>
                  currentEntry,

              saveNoteVersion:
                saveNoteVersionMock,

              removeQueuedSave:
                async () => {
                  currentEntry = null;
                },
            }),
          );

        const firstReplay =
          coordinator.replay();

        const secondReplay =
          coordinator.replay();

        expect(secondReplay).toBe(
          firstReplay,
        );

        await vi.waitFor(() => {
          expect(
            saveNoteVersionMock,
          ).toHaveBeenCalledTimes(1);
        });

        releaseSave();

        await firstReplay;

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "keeps a failed entry and pauses replay",
      async () => {
        const firstEntry =
          createEntry(1);

        const secondEntry =
          createEntry(2);

        const entries = [
          firstEntry,
          secondEntry,
        ];

        const removedSequences:
          number[] = [];

        const recordFailureMock =
          vi.fn(
            async () => firstEntry,
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () =>
                  entries[0] ?? null,

              saveNoteVersion:
                async () => {
                  throw new TypeError(
                    "Network request failed.",
                  );
                },

              removeQueuedSave:
                async sequence => {
                  removedSequences.push(
                    sequence,
                  );
                },

              recordSaveAttemptFailure:
                recordFailureMock,
            }),
          );

        await coordinator.replay();

        expect(
          removedSequences,
        ).toEqual([]);

        expect(
          recordFailureMock,
        ).toHaveBeenCalledWith(
          1,
          "Network request failed.",
        );

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "paused-error",
          currentSequence: 1,
          replayedCount: 0,
          lastError:
            "Network request failed.",
        });
      },
    );

    it(
      "starts replay when the browser returns online",
      async () => {
        const eventTarget =
          new TestEventTarget();

        let online = false;

        const entry = createEntry(1);

        let currentEntry:
          | PersistedQueuedNoteVersionSave
          | null = entry;

        const saveNoteVersionMock =
          vi.fn(
            async () =>
              createSaveResponse(entry),
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              eventTarget,

              isOnline:
                () => online,

              getOldestQueuedSave:
                async () =>
                  currentEntry,

              saveNoteVersion:
                saveNoteVersionMock,

              removeQueuedSave:
                async () => {
                  currentEntry = null;
                },
            }),
          );

        coordinator.start();

        expect(
          coordinator.getSnapshot()
            .status,
        ).toBe("offline");

        online = true;

        eventTarget.dispatch("online");

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          coordinator.getSnapshot()
            .status,
        ).toBe("idle");

        coordinator.stop();
      },
    );

    it(
      "removes connectivity listeners when stopped",
      () => {
        const eventTarget =
          new TestEventTarget();

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              eventTarget,
            }),
          );

        coordinator.start();

        expect(
          eventTarget.listenerCount(
            "online",
          ),
        ).toBe(1);

        expect(
          eventTarget.listenerCount(
            "offline",
          ),
        ).toBe(1);

        coordinator.stop();

        expect(
          eventTarget.listenerCount(
            "online",
          ),
        ).toBe(0);

        expect(
          eventTarget.listenerCount(
            "offline",
          ),
        ).toBe(0);
      },
    );
  },
);