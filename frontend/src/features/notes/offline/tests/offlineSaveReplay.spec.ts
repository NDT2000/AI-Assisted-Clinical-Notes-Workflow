import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { NoteVersionDetail } from "../../../../domain/noteDetail";
import type { SaveNoteVersionResponse } from "../../../../domain/noteSave";

import {
  SaveNoteVersionRequestError,
} from "../../api/saveNoteVersion";

import type {
  PersistedQueuedNoteVersionSave,
} from "../offlineRepository";

import type {
  OfflineSaveConflict,
} from "../offlineStorageTypes";

import {
  OfflineSaveReplayCoordinator,
  getOfflineReplayBackoffDelayMs,
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
        subjective:
          `Subjective ${sequence}`,

        objective:
          `Objective ${sequence}`,

        assessment:
          `Assessment ${sequence}`,

        plan:
          `Plan ${sequence}`,
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

function createVersion(
  versionId: string,
  revisionNumber: number,
  parentVersionId: string | null,
): NoteVersionDetail {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber,
    parentVersionId,

    content: {
      subjective:
        `Subjective ${revisionNumber}`,

      objective:
        `Objective ${revisionNumber}`,

      assessment:
        `Assessment ${revisionNumber}`,

      plan:
        `Plan ${revisionNumber}`,
    },

    authorId: "reviewer-2",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Reviewer Two",

    createdAt:
      "2026-08-01T18:00:00.000Z",
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

    markSaveConflict:
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

    sleep:
      async () => undefined,

    getRetryDelayMs:
      getOfflineReplayBackoffDelayMs,

    maxRetryCount: 3,

    ...overrides,
  };
}

function recordFailureForEntry(
  getEntry: () =>
    PersistedQueuedNoteVersionSave,
  setEntry: (
    entry:
      PersistedQueuedNoteVersionSave,
  ) => void,
): OfflineSaveReplayDependencies["recordSaveAttemptFailure"] {
  return async (
    sequence,
    errorMessage,
    attemptedAt = Date.now(),
  ) => {
    const existing =
      getEntry();

    expect(
      existing.sequence,
    ).toBe(sequence);

    const updated:
      PersistedQueuedNoteVersionSave = {
        ...existing,
        state: "queued",
        retryCount:
          existing.retryCount + 1,
        lastAttemptAt: attemptedAt,
        lastError: errorMessage,
      };

    setEntry(updated);

    return updated;
  };
}

describe(
  "getOfflineReplayBackoffDelayMs",
  () => {
    it(
      "returns capped exponential delays",
      () => {
        expect(
          getOfflineReplayBackoffDelayMs(
            1,
          ),
        ).toBe(250);

        expect(
          getOfflineReplayBackoffDelayMs(
            2,
          ),
        ).toBe(500);

        expect(
          getOfflineReplayBackoffDelayMs(
            3,
          ),
        ).toBe(1_000);

        expect(
          getOfflineReplayBackoffDelayMs(
            4,
          ),
        ).toBe(1_000);
      },
    );
  },
);

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

                  if (
                    entry === undefined
                  ) {
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
          retryCount: 0,
          nextRetryDelayMs: null,
          lastError: null,
          blockedConflict: null,
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
          () => void =
            () => undefined;

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
      "retries the same entry with exponential backoff before continuing",
      async () => {
        let currentEntry:
          | PersistedQueuedNoteVersionSave
          | null = createEntry(1);

        let saveAttempt = 0;

        const retryDelays:
          number[] = [];

        const saveNoteVersionMock =
          vi.fn(
            async () => {
              saveAttempt += 1;

              if (saveAttempt <= 2) {
                throw new TypeError(
                  "Network request failed.",
                );
              }

              if (
                currentEntry === null
              ) {
                throw new Error(
                  "Expected a queued entry.",
                );
              }

              return createSaveResponse(
                currentEntry,
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

              recordSaveAttemptFailure:
                recordFailureForEntry(
                  () => {
                    if (
                      currentEntry ===
                      null
                    ) {
                      throw new Error(
                        "Expected a queued entry.",
                      );
                    }

                    return currentEntry;
                  },

                  updatedEntry => {
                    currentEntry =
                      updatedEntry;
                  },
                ),

              sleep:
                async delayMs => {
                  retryDelays.push(
                    delayMs,
                  );
                },

              removeQueuedSave:
                async sequence => {
                  expect(sequence).toBe(
                    1,
                  );

                  currentEntry = null;
                },
            }),
          );

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(3);

        expect(
          retryDelays,
        ).toEqual([250, 500]);

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "idle",
          currentSequence: null,
          replayedCount: 1,
          retryCount: 0,
          nextRetryDelayMs: null,
          lastError: null,
          blockedConflict: null,
        });
      },
    );

    it(
      "pauses after the retry limit without processing a later entry",
      async () => {
        let firstEntry =
          createEntry(1);

        const secondEntry =
          createEntry(2);

        const removedSequences:
          number[] = [];

        const retryDelays:
          number[] = [];

        const saveNoteVersionMock =
          vi.fn(
            async () => {
              throw new TypeError(
                "Network request failed.",
              );
            },
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () =>
                  firstEntry,

              saveNoteVersion:
                saveNoteVersionMock,

              recordSaveAttemptFailure:
                recordFailureForEntry(
                  () => firstEntry,

                  updatedEntry => {
                    firstEntry =
                      updatedEntry;
                  },
                ),

              sleep:
                async delayMs => {
                  retryDelays.push(
                    delayMs,
                  );
                },

              removeQueuedSave:
                async sequence => {
                  removedSequences.push(
                    sequence,
                  );
                },
            }),
          );

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(4);

        expect(
          retryDelays,
        ).toEqual([
          250,
          500,
          1_000,
        ]);

        expect(
          removedSequences,
        ).toEqual([]);

        expect(
          firstEntry.sequence,
        ).toBeLessThan(
          secondEntry.sequence,
        );

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "paused-error",
          currentSequence: 1,
          replayedCount: 0,
          retryCount: 4,
          nextRetryDelayMs: null,
          lastError:
            "Network request failed.",
          blockedConflict: null,
        });
      },
    );

    it(
      "persists a replay conflict and stops before later entries",
      async () => {
        const firstEntry =
          createEntry(1);

        const secondEntry =
          createEntry(2);

        const entries:
          PersistedQueuedNoteVersionSave[] = [
            firstEntry,
            secondEntry,
          ];

        const currentVersion =
          createVersion(
            "server-version-2",
            2,
            "version-1",
          );

        const commonAncestor =
          createVersion(
            "version-1",
            1,
            null,
          );

        const conflictError =
          new SaveNoteVersionRequestError(
            {
              status: 409,
              code:
                "version_conflict",
              message:
                "The note has changed on the server.",
              currentVersion,
              commonAncestor,
            },
          );

        const saveNoteVersionMock =
          vi.fn(
            async () => {
              throw conflictError;
            },
          );

        const removeQueuedSaveMock =
          vi.fn(
            async () => undefined,
          );

        const recordFailureMock =
          vi.fn(
            async () => null,
          );

        const sleepMock =
          vi.fn(
            async () => undefined,
          );

        const markSaveConflictMock =
          vi.fn(
            async (
              sequence: number,
              conflict:
                OfflineSaveConflict,
            ) => {
              expect(sequence).toBe(1);

              const blockedEntry:
                PersistedQueuedNoteVersionSave = {
                  ...firstEntry,
                  state:
                    "blocked-conflict",
                  lastAttemptAt:
                    Date.now(),
                  lastError:
                    conflict.message,
                  conflict,
                };

              entries[0] =
                blockedEntry;

              return blockedEntry;
            },
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () =>
                  entries.find(
                    entry =>
                      entry.state ===
                      "queued",
                  ) ?? null,

              saveNoteVersion:
                saveNoteVersionMock,

              markSaveConflict:
                markSaveConflictMock,

              recordSaveAttemptFailure:
                recordFailureMock,

              removeQueuedSave:
                removeQueuedSaveMock,

              sleep: sleepMock,
            }),
          );

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          markSaveConflictMock,
        ).toHaveBeenCalledWith(
          1,
          {
            message:
              "The note has changed on the server.",
            currentVersion,
            commonAncestor,
          },
        );

        expect(
          recordFailureMock,
        ).not.toHaveBeenCalled();

        expect(
          removeQueuedSaveMock,
        ).not.toHaveBeenCalled();

        expect(
          sleepMock,
        ).not.toHaveBeenCalled();

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status:
            "blocked-conflict",
          currentSequence: 1,
          replayedCount: 0,
          retryCount: 0,
          nextRetryDelayMs: null,
          lastError:
            "The note has changed on the server.",

          blockedConflict: {
            sequence: 1,
            noteId: "note-1",
            state:
              "blocked-conflict",

            conflict: {
              currentVersion,
              commonAncestor,
            },
          },
        });

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).toHaveBeenCalledTimes(1);

        expect(entries[1]).toBe(
          secondEntry,
        );
      },
    );

    it(
      "does not retry a terminal server error",
      async () => {
        let entry =
          createEntry(1);

        const sleepMock =
          vi.fn(
            async () => undefined,
          );

        const removeQueuedSaveMock =
          vi.fn(
            async () => undefined,
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getOldestQueuedSave:
                async () => entry,

              saveNoteVersion:
                async () => {
                  throw new SaveNoteVersionRequestError(
                    {
                      status: 403,
                      code: "forbidden",
                      message:
                        "You are not allowed to save this note.",
                    },
                  );
                },

              recordSaveAttemptFailure:
                recordFailureForEntry(
                  () => entry,

                  updatedEntry => {
                    entry =
                      updatedEntry;
                  },
                ),

              sleep: sleepMock,

              removeQueuedSave:
                removeQueuedSaveMock,
            }),
          );

        await coordinator.replay();

        expect(
          sleepMock,
        ).not.toHaveBeenCalled();

        expect(
          removeQueuedSaveMock,
        ).not.toHaveBeenCalled();

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "paused-error",
          currentSequence: 1,
          replayedCount: 0,
          retryCount: 1,
          nextRetryDelayMs: null,
          lastError:
            "You are not allowed to save this note.",
          blockedConflict: null,
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