import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  SaveNoteVersionActor,
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../../../domain/noteSave";

vi.mock(
  "../../api/saveNoteVersion",
  async () => {
    const actual =
      await vi.importActual<
        typeof import(
          "../../api/saveNoteVersion"
        )
      >("../../api/saveNoteVersion");

    return {
      ...actual,
      saveNoteVersion: vi.fn(),
    };
  },
);

vi.mock(
  "../offlineRepository",
  async () => {
    const actual =
      await vi.importActual<
        typeof import(
          "../offlineRepository"
        )
      >("../offlineRepository");

    return {
      ...actual,
      queueLatestSaveForNote: vi.fn(),
    };
  },
);

import {
  SaveNoteVersionRequestError,
  saveNoteVersion,
} from "../../api/saveNoteVersion";

import {
  queueLatestSaveForNote,
  type PersistedQueuedNoteVersionSave,
} from "../offlineRepository";

import {
  saveNoteVersionWithOfflineQueue,
} from "../saveNoteVersionWithOfflineQueue";

const saveNoteVersionMock =
  vi.mocked(saveNoteVersion);

const queueLatestSaveForNoteMock =
  vi.mocked(queueLatestSaveForNote);

const actor: SaveNoteVersionActor = {
  id: "reviewer-1",
  displayName: "Alex Reviewer",
  role: "REVIEWER",
};

const request: SaveNoteVersionRequestBody = {
  baseVersionId: "version-1",
  clientMutationId: "mutation-1",

  content: {
    subjective: "Updated subjective",
    objective: "Updated objective",
    assessment: "Updated assessment",
    plan: "Updated plan",
  },
};

function setNavigatorOnline(
  online: boolean,
): void {
  Object.defineProperty(
    window.navigator,
    "onLine",
    {
      configurable: true,
      value: online,
    },
  );
}

function createQueuedEntry():
  PersistedQueuedNoteVersionSave {
  return {
    sequence: 1,
    kind: "save-note-version",

    noteId: "note-1",
    actor,
    request,

    queuedAt: 100,
    state: "queued",

    retryCount: 0,
    lastAttemptAt: null,
    lastError: null,
    conflict: null,
  };
}

beforeEach(() => {
  setNavigatorOnline(true);

  saveNoteVersionMock.mockReset();
  queueLatestSaveForNoteMock.mockReset();
});

describe(
  "saveNoteVersionWithOfflineQueue",
  () => {
    it("returns a saved result after a successful server save", async () => {
      const response =
        {
          clientMutationId:
            "mutation-1",
        } as SaveNoteVersionResponse;

      saveNoteVersionMock
        .mockResolvedValueOnce(response);

      const result =
        await saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
        );

      expect(result).toEqual({
        kind: "saved",
        response,
      });

      expect(
        saveNoteVersionMock,
      ).toHaveBeenCalledWith(
        "note-1",
        actor,
        request,
        undefined,
      );

      expect(
        queueLatestSaveForNoteMock,
      ).not.toHaveBeenCalled();
    });

    it("queues directly without sending a request when offline", async () => {
      setNavigatorOnline(false);

      const entry =
        createQueuedEntry();

      queueLatestSaveForNoteMock
        .mockResolvedValueOnce(entry);

      const result =
        await saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
        );

      expect(result).toEqual({
        kind: "queued",
        entry,
      });

      expect(
        saveNoteVersionMock,
      ).not.toHaveBeenCalled();

      expect(
        queueLatestSaveForNoteMock,
      ).toHaveBeenCalledWith({
        noteId: "note-1",
        actor,
        request,
      });
    });

    it("queues after fetch fails without receiving an HTTP response", async () => {
      const entry =
        createQueuedEntry();

      saveNoteVersionMock
        .mockRejectedValueOnce(
          new TypeError(
            "Failed to fetch",
          ),
        );

      queueLatestSaveForNoteMock
        .mockResolvedValueOnce(entry);

      const result =
        await saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
        );

      expect(result).toEqual({
        kind: "queued",
        entry,
      });

      expect(
        queueLatestSaveForNoteMock,
      ).toHaveBeenCalledWith({
        noteId: "note-1",
        actor,
        request,
      });
    });

    it("does not queue a server authorization error", async () => {
      const error =
        new SaveNoteVersionRequestError({
          status: 403,
          code: "forbidden",
          message:
            "You are not authorized to save this note.",
        });

      saveNoteVersionMock
        .mockRejectedValueOnce(error);

      await expect(
        saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
        ),
      ).rejects.toBe(error);

      expect(
        queueLatestSaveForNoteMock,
      ).not.toHaveBeenCalled();
    });

    it("does not queue a version conflict", async () => {
      const error =
        new SaveNoteVersionRequestError({
          status: 409,
          code: "version_conflict",
          message:
            "The note has a newer version.",
        });

      saveNoteVersionMock
        .mockRejectedValueOnce(error);

      await expect(
        saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
        ),
      ).rejects.toBe(error);

      expect(
        queueLatestSaveForNoteMock,
      ).not.toHaveBeenCalled();
    });

    it("does not queue an aborted request", async () => {
      const controller =
        new AbortController();

      controller.abort();

      await expect(
        saveNoteVersionWithOfflineQueue(
          "note-1",
          actor,
          request,
          controller.signal,
        ),
      ).rejects.toMatchObject({
        name: "AbortError",
      });

      expect(
        saveNoteVersionMock,
      ).not.toHaveBeenCalled();

      expect(
        queueLatestSaveForNoteMock,
      ).not.toHaveBeenCalled();
    });
  },
);