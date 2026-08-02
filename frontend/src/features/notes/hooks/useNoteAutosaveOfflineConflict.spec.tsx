import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const replayMocks = vi.hoisted(() => ({
  snapshot: {
    status: "idle",
    pendingCount: 0,
    currentSequence: null,
    replayedCount: 0,
    retryCount: 0,
    nextRetryDelayMs: null,
    lastError: null,
    blockedConflict: null,
  } as Record<string, unknown>,

  listeners: new Set<
    (snapshot: Record<string, unknown>) => void
  >(),

  resolveBlockedConflict: vi.fn(),
  replay: vi.fn(),
}));

vi.mock(
  "../offline/offlineSaveReplay",
  () => ({
    offlineSaveReplayCoordinator: {
      getSnapshot: () =>
        replayMocks.snapshot,

      subscribe: (
        listener: (
          snapshot:
            Record<string, unknown>,
        ) => void,
      ) => {
        replayMocks.listeners.add(
          listener,
        );

        return () => {
          replayMocks.listeners.delete(
            listener,
          );
        };
      },

      resolveBlockedConflict:
        replayMocks.resolveBlockedConflict,

      replay: replayMocks.replay,
    },
  }),
);

import type { SoapContent } from "../../../domain/noteAttributes";
import type { NoteVersionDetail } from "../../../domain/noteDetail";
import type {
  SaveNoteVersionActor,
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";
import type {
  PersistedQueuedNoteVersionSave,
} from "../offline/offlineRepository";
import { useNoteAutosave } from "./useNoteAutosave";

const actor: SaveNoteVersionActor = {
  id: "reviewer-1",
  displayName: "Reviewer One",
  role: "REVIEWER",
};

const ancestorContent: SoapContent = {
  subjective: "Ancestor subjective",
  objective: "Ancestor objective",
  assessment: "Ancestor assessment",
  plan: "Ancestor plan",
};

const localContent: SoapContent = {
  ...ancestorContent,
  plan: "Local offline plan",
};

const serverContent: SoapContent = {
  ...ancestorContent,
  plan: "Server plan",
};

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

function createBlockedEntry(): PersistedQueuedNoteVersionSave {
  const commonAncestor =
    createVersion(
      "version-1",
      1,
      ancestorContent,
      null,
    );

  const currentVersion =
    createVersion(
      "server-version-2",
      2,
      serverContent,
      commonAncestor.versionId,
    );

  return {
    sequence: 1,
    kind: "save-note-version",
    noteId: "note-1",
    actor,
    request: {
      baseVersionId:
        commonAncestor.versionId,
      clientMutationId:
        "offline-mutation-1",
      content: localContent,
    },
    queuedAt: Date.now(),
    state: "blocked-conflict",
    retryCount: 0,
    lastAttemptAt: Date.now(),
    lastError:
      "The note changed on the server.",
    conflict: {
      message:
        "The note changed on the server.",
      currentVersion,
      commonAncestor,
    },
  };
}

function createResolutionResponse(
  content: SoapContent,
): SaveNoteVersionResponse {
  return {
    clientMutationId:
      "resolution-mutation-1",
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId:
        "resolved-version-3",
      assignedReviewerId: actor.id,
      createdAt:
        "2026-08-01T18:00:00.000Z",
      updatedAt:
        "2026-08-01T20:05:00.000Z",
    },
    savedVersion: {
      versionId:
        "resolved-version-3",
      noteId: "note-1",
      revisionNumber: 3,
      parentVersionId:
        "server-version-2",
      content,
      authorId: actor.id,
      authorRole: actor.role,
      authorDisplayName:
        actor.displayName,
      createdAt:
        "2026-08-01T20:05:00.000Z",
    },
  };
}

function publishReplaySnapshot(
  snapshot: Record<string, unknown>,
): void {
  replayMocks.snapshot = snapshot;

  for (const listener of replayMocks.listeners) {
    listener(snapshot);
  }
}

describe(
  "useNoteAutosave offline replay conflict",
  () => {
    beforeEach(() => {
      replayMocks.listeners.clear();
      replayMocks.resolveBlockedConflict.mockReset();
      replayMocks.replay.mockReset();

      replayMocks.snapshot = {
        status: "idle",
        pendingCount: 0,
        currentSequence: null,
        replayedCount: 0,
        retryCount: 0,
        nextRetryDelayMs: null,
        lastError: null,
        blockedConflict: null,
      };
    });

    it(
      "exposes a blocked replay through the normal conflict contract and reports resolution success",
      async () => {
        const blockedEntry =
          createBlockedEntry();

        replayMocks.snapshot = {
          status:
            "blocked-conflict",
          pendingCount: 1,
          currentSequence: 1,
          replayedCount: 0,
          retryCount: 0,
          nextRetryDelayMs: null,
          lastError:
            blockedEntry.conflict
              ?.message ?? null,
          blockedConflict:
            blockedEntry,
        };

        const resolvedContent = {
          ...serverContent,
          plan: "Resolved plan",
        };

        const response =
          createResolutionResponse(
            resolvedContent,
          );

        replayMocks.resolveBlockedConflict.mockImplementation(
          async () => {
            publishReplaySnapshot({
              status: "idle",
              pendingCount: 0,
              currentSequence: null,
              replayedCount: 1,
              retryCount: 0,
              nextRetryDelayMs: null,
              lastError: null,
              blockedConflict: null,
            });

            return response;
          },
        );

        const onSaveSuccess = vi.fn();

        const { result } = renderHook(
          () =>
            useNoteAutosave({
              noteId: "note-1",
              actor,
              initialBaseVersionId:
                "version-1",
              initialContent:
                ancestorContent,
              debounceMs: 500,
              onSaveSuccess,
            }),
        );

        expect(
          result.current.snapshot.status,
        ).toBe("conflict");

        expect(
          result.current.snapshot
            .hasPendingChanges,
        ).toBe(true);

        expect(
          result.current.conflict,
        ).toEqual(
          blockedEntry.conflict,
        );

        act(() => {
          result.current.resolveConflict(
            resolvedContent,
            "server-version-2",
          );
        });

        expect(
          replayMocks.resolveBlockedConflict,
        ).toHaveBeenCalledWith(
          resolvedContent,
        );

        await waitFor(() => {
          expect(
            onSaveSuccess,
          ).toHaveBeenCalledWith({
            response,
            savedContent:
              resolvedContent,
          });
        });

        await waitFor(() => {
          expect(
            result.current.snapshot.status,
          ).toBe("idle");
        });

        expect(
          result.current.conflict,
        ).toBeNull();
      },
    );
  },
);