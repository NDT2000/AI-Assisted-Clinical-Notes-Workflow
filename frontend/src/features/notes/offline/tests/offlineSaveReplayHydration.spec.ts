import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  NoteVersionDetail,
} from "../../../../domain/noteDetail";
import type {
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";

import type {
  PersistedQueuedNoteVersionSave,
} from "../offlineRepository";
import {
  OfflineSaveReplayCoordinator,
  getOfflineReplayBackoffDelayMs,
  type OfflineSaveReplayDependencies,
} from "../offlineSaveReplay";

function createQueuedEntry(
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
): NoteVersionDetail {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber: 2,
    parentVersionId: "version-1",
    content: {
      subjective: "Server subjective",
      objective: "Server objective",
      assessment: "Server assessment",
      plan: "Server plan",
    },
    authorId: "reviewer-2",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Reviewer Two",
    createdAt:
      "2026-08-01T20:00:00.000Z",
  };
}

function createDependencies(
  overrides:
    Partial<OfflineSaveReplayDependencies> = {},
): OfflineSaveReplayDependencies {
  return {
    getQueuedSaves:
      async () => [],
    getOldestQueuedSave:
      async () => null,
    removeQueuedSave:
      async () => undefined,
    recordSaveAttemptFailure:
      async () => null,
    markSaveConflict:
      async () => null,
    replaceBlockedSaveWithResolution:
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
    createClientMutationId:
      () => "resolution-1",
    ...overrides,
  };
}

describe(
  "OfflineSaveReplayCoordinator hydration",
  () => {
    it(
      "restores a persisted queue count for a new offline coordinator",
      async () => {
        const queuedEntry =
          createQueuedEntry(1);

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getQueuedSaves:
                async () => [
                  queuedEntry,
                ],
              getOldestQueuedSave:
                async () =>
                  queuedEntry,
              isOnline: () => false,
            }),
          );

        expect(
          coordinator.getSnapshot()
            .isHydrated,
        ).toBe(false);

        await coordinator.replay();

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status: "offline",
          isHydrated: true,
          pendingCount: 1,
          blockedConflict: null,
        });
      },
    );

    it(
      "restores a blocked conflict without replaying a later mutation",
      async () => {
        const blockedEntry = {
          ...createQueuedEntry(1),
          state:
            "blocked-conflict",
          lastAttemptAt: 2,
          lastError:
            "The note changed on the server.",
          conflict: {
            message:
              "The note changed on the server.",
            currentVersion:
              createVersion(
                "server-version-2",
              ),
            commonAncestor: null,
          },
        } satisfies PersistedQueuedNoteVersionSave;

        const laterEntry =
          createQueuedEntry(2);

        const saveNoteVersionMock =
          vi.fn(
            async () =>
              ({
                clientMutationId:
                  "unexpected",
              }) as SaveNoteVersionResponse,
          );

        const coordinator =
          new OfflineSaveReplayCoordinator(
            createDependencies({
              getQueuedSaves:
                async () => [
                  blockedEntry,
                  laterEntry,
                ],
              getOldestQueuedSave:
                async () =>
                  laterEntry,
              saveNoteVersion:
                saveNoteVersionMock,
            }),
          );

        await coordinator.replay();

        expect(
          saveNoteVersionMock,
        ).not.toHaveBeenCalled();

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status:
            "blocked-conflict",
          isHydrated: true,
          pendingCount: 2,
          currentSequence: 1,
          blockedConflict: {
            sequence: 1,
            noteId: "note-1",
          },
        });
      },
    );
  },
);