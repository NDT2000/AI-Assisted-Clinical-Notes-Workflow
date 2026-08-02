import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SoapContent } from "../../../../domain/noteAttributes";
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

function createContent(
  label: string,
): SoapContent {
  return {
    subjective: `${label} subjective`,
    objective: `${label} objective`,
    assessment: `${label} assessment`,
    plan: `${label} plan`,
  };
}

function createVersion(
  versionId: string,
  revisionNumber: number,
  content: SoapContent,
  parentVersionId: string | null,
): NoteVersionDetail {
  return {
    versionId,
    noteId: "note-1",
    revisionNumber,
    parentVersionId,
    content,
    authorId: "reviewer-2",
    authorRole: "REVIEWER",
    authorDisplayName:
      "Reviewer Two",
    createdAt:
      "2026-08-01T20:00:00.000Z",
  };
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
      content:
        createContent(
          `Local ${sequence}`,
        ),
    },
    queuedAt: sequence,
    state: "queued",
    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    conflict: null,
  };
}

function createResponse(
  entry: PersistedQueuedNoteVersionSave,
  versionId: string,
): SaveNoteVersionResponse {
  return {
    clientMutationId:
      entry.request.clientMutationId,
    note: {
      id: entry.noteId,
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: versionId,
      assignedReviewerId:
        entry.actor.id,
      createdAt:
        "2026-08-01T18:00:00.000Z",
      updatedAt:
        "2026-08-01T20:05:00.000Z",
    },
    savedVersion: {
      versionId,
      noteId: entry.noteId,
      revisionNumber: 3,
      parentVersionId:
        entry.request.baseVersionId,
      content:
        entry.request.content,
      authorId: entry.actor.id,
      authorRole: entry.actor.role,
      authorDisplayName:
        entry.actor.displayName,
      createdAt:
        "2026-08-01T20:05:00.000Z",
    },
  };
}

describe(
  "OfflineSaveReplayCoordinator conflict resolution",
  () => {
    it(
      "saves a resolution against the server head and resumes FIFO replay",
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

        const commonAncestor =
          createVersion(
            "version-1",
            1,
            createContent("Ancestor"),
            null,
          );

        const serverHead =
          createVersion(
            "server-version-2",
            2,
            createContent("Server"),
            commonAncestor.versionId,
          );

        const resolvedContent = {
          ...serverHead.content,
          plan: "Resolved plan",
        };

        const saveNoteVersionMock =
          vi.fn(
            async (
              _noteId: string,
              _actor:
                PersistedQueuedNoteVersionSave["actor"],
              request:
                PersistedQueuedNoteVersionSave["request"],
            ) => {
              if (
                request.clientMutationId ===
                "mutation-1"
              ) {
                throw new SaveNoteVersionRequestError(
                  {
                    status: 409,
                    code:
                      "version_conflict",
                    message:
                      "The note changed on the server.",
                    currentVersion:
                      serverHead,
                    commonAncestor,
                  },
                );
              }

              const entry =
                entries.find(
                  candidate =>
                    candidate.request
                      .clientMutationId ===
                    request.clientMutationId,
                );

              if (!entry) {
                throw new Error(
                  "Expected a queued entry for the save request.",
                );
              }

              return createResponse(
                entry,
                request.clientMutationId ===
                  "resolution-mutation-1"
                  ? "resolved-version-3"
                  : "second-version-2",
              );
            },
          );

        const dependencies:
          OfflineSaveReplayDependencies = {
          getQueuedSaves:
            async () =>
              [...entries].sort(
                (left, right) =>
                  left.sequence -
                  right.sequence,
              ),

          getOldestQueuedSave:
            async () =>
              [...entries]
                .filter(
                  entry =>
                    entry.state ===
                    "queued",
                )
                .sort(
                  (left, right) =>
                    left.sequence -
                    right.sequence,
                )[0] ?? null,

          removeQueuedSave:
            async sequence => {
              const index =
                entries.findIndex(
                  entry =>
                    entry.sequence ===
                    sequence,
                );

              if (index >= 0) {
                entries.splice(index, 1);
              }
            },

          recordSaveAttemptFailure:
            async () => null,

          markSaveConflict:
            async (
              sequence: number,
              conflict:
                OfflineSaveConflict,
            ) => {
              const index =
                entries.findIndex(
                  entry =>
                    entry.sequence ===
                    sequence,
                );

              if (index < 0) {
                return null;
              }

              const blockedEntry:
                PersistedQueuedNoteVersionSave = {
                ...entries[index],
                state:
                  "blocked-conflict",
                lastAttemptAt:
                  Date.now(),
                lastError:
                  conflict.message,
                conflict,
              };

              entries[index] =
                blockedEntry;

              return blockedEntry;
            },

          replaceBlockedSaveWithResolution:
            async ({
              sequence,
              request,
            }) => {
              const index =
                entries.findIndex(
                  entry =>
                    entry.sequence ===
                      sequence &&
                    entry.state ===
                      "blocked-conflict",
                );

              if (index < 0) {
                return null;
              }

              const resolvedEntry:
                PersistedQueuedNoteVersionSave = {
                ...entries[index],
                request,
                state: "queued",
                retryCount: 0,
                lastAttemptAt: null,
                lastError: null,
                conflict: null,
              };

              entries[index] =
                resolvedEntry;

              return resolvedEntry;
            },

          saveNoteVersion:
            saveNoteVersionMock,

          isOnline: () => true,
          eventTarget: null,
          sleep:
            async () => undefined,
          getRetryDelayMs:
            getOfflineReplayBackoffDelayMs,
          maxRetryCount: 3,
          createClientMutationId:
            () =>
              "resolution-mutation-1",
        };

        const coordinator =
          new OfflineSaveReplayCoordinator(
            dependencies,
          );

        coordinator.start();

        await coordinator.replay();

        expect(
          coordinator.getSnapshot(),
        ).toMatchObject({
          status:
            "blocked-conflict",
          currentSequence: 1,
          blockedConflict: {
            sequence: 1,
            state:
              "blocked-conflict",
          },
        });

        const resolutionResponse =
          await coordinator
            .resolveBlockedConflict(
              resolvedContent,
            );

        expect(
          resolutionResponse
            ?.savedVersion.versionId,
        ).toBe("resolved-version-3");

        expect(
          saveNoteVersionMock.mock
            .calls[1]?.[2],
        ).toEqual({
          baseVersionId:
            serverHead.versionId,
          clientMutationId:
            "resolution-mutation-1",
          content: resolvedContent,
        });

        await vi.waitFor(() => {
          expect(entries).toHaveLength(0);

          expect(
            coordinator.getSnapshot(),
          ).toMatchObject({
            status: "idle",
            currentSequence: null,
            replayedCount: 2,
            blockedConflict: null,
            lastError: null,
          });
        });

        expect(
          saveNoteVersionMock.mock.calls.map(
            call =>
              call[2].clientMutationId,
          ),
        ).toEqual([
          "mutation-1",
          "resolution-mutation-1",
          "mutation-2",
        ]);

        coordinator.stop();
      },
    );
  },
);