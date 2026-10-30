import {
  act,
  renderHook,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const saveMocks = vi.hoisted(() => ({
  saveNoteVersionWithOfflineQueue: vi.fn(),
  queueNoteVersionSave: vi.fn(),
}));

// useSyncExternalStore requires a stable snapshot object.
const idleReplaySnapshot = vi.hoisted(() => ({
  status: "idle",
  pendingCount: 0,
  currentSequence: null,
  replayedCount: 0,
  retryCount: 0,
  nextRetryDelayMs: null,
  lastError: null,
  blockedConflict: null,
}));

vi.mock(
  "../offline/saveNoteVersionWithOfflineQueue",
  () => saveMocks,
);

vi.mock(
  "../offline/offlineSaveReplay",
  () => ({
    offlineSaveReplayCoordinator: {
      getSnapshot: () =>
        idleReplaySnapshot,
      subscribe: () => () => {},
      resolveBlockedConflict: vi.fn(),
      replay: vi.fn(),
    },
  }),
);

import type { SoapContent } from "../../../domain/noteAttributes";
import type {
  SaveNoteVersionActor,
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../../domain/noteSave";
import { SaveNoteVersionRequestError } from "../api/saveNoteVersion";
import { useNoteAutosave } from "./useNoteAutosave";

const actor: SaveNoteVersionActor = {
  id: "reviewer-1",
  displayName: "Reviewer One",
  role: "REVIEWER",
};

const initialContent: SoapContent = {
  subjective: "Initial subjective",
  objective: "Initial objective",
  assessment: "Initial assessment",
  plan: "Initial plan",
};

const editedContent: SoapContent = {
  ...initialContent,
  subjective: "Edited just before leaving",
};

function createSaveResponse(
  request: SaveNoteVersionRequestBody,
): SaveNoteVersionResponse {
  return {
    clientMutationId:
      request.clientMutationId,
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: "version-2",
      assignedReviewerId: "reviewer-1",
      createdAt:
        "2026-08-01T20:00:00.000Z",
      updatedAt:
        "2026-08-01T20:30:00.000Z",
    },
    savedVersion: {
      versionId: "version-2",
      noteId: "note-1",
      revisionNumber: 2,
      parentVersionId:
        request.baseVersionId,
      content: { ...request.content },
      authorId: "reviewer-1",
      authorRole: "REVIEWER",
      authorDisplayName:
        "Reviewer One",
      createdAt:
        "2026-08-01T20:30:00.000Z",
    },
  };
}

function renderAutosave() {
  return renderHook(() =>
    useNoteAutosave({
      noteId: "note-1",
      actor,
      initialBaseVersionId: "version-1",
      initialContent,
      debounceMs: 500,
      onSaveSuccess: vi.fn(),
    }),
  );
}

function dispatchBeforeUnload(): Event {
  const event = new Event(
    "beforeunload",
    { cancelable: true },
  );

  window.dispatchEvent(event);

  return event;
}

async function failNextSaveWith(
  error: unknown,
  result: ReturnType<typeof renderAutosave>["result"],
): Promise<void> {
  saveMocks.saveNoteVersionWithOfflineQueue
    .mockRejectedValueOnce(error);

  act(() => {
    result.current.updateDraft(
      editedContent,
    );
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

describe("useNoteAutosave when the editor closes", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    saveMocks.saveNoteVersionWithOfflineQueue
      .mockReset()
      .mockImplementation(
        async (
          _noteId: string,
          _actor: SaveNoteVersionActor,
          request: SaveNoteVersionRequestBody,
        ) => ({
          kind: "saved",
          response:
            createSaveResponse(request),
        }),
      );

    saveMocks.queueNoteVersionSave
      .mockReset()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("saves an edit made inside the debounce window instead of dropping it", () => {
    const { result, unmount } =
      renderAutosave();

    act(() => {
      result.current.updateDraft(
        editedContent,
      );
    });

    expect(
      saveMocks.saveNoteVersionWithOfflineQueue,
    ).not.toHaveBeenCalled();

    unmount();

    expect(
      saveMocks.saveNoteVersionWithOfflineQueue,
    ).toHaveBeenCalledWith(
      "note-1",
      actor,
      expect.objectContaining({
        baseVersionId: "version-1",
        content: editedContent,
      }),
    );
  });

  it("starts the pending save when the tab is hidden", () => {
    const { result, unmount } =
      renderAutosave();

    act(() => {
      result.current.updateDraft(
        editedContent,
      );
    });

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");

    act(() => {
      document.dispatchEvent(
        new Event("visibilitychange"),
      );
    });

    expect(
      saveMocks.saveNoteVersionWithOfflineQueue,
    ).toHaveBeenCalledTimes(1);

    visibility.mockRestore();
    unmount();
  });

  it("warns before unload only while edits are unsaved", async () => {
    const { result, unmount } =
      renderAutosave();

    expect(
      dispatchBeforeUnload().defaultPrevented,
    ).toBe(false);

    act(() => {
      result.current.updateDraft(
        editedContent,
      );
    });

    expect(
      result.current.hasUnsavedChanges,
    ).toBe(true);

    expect(
      dispatchBeforeUnload().defaultPrevented,
    ).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(
      result.current.hasUnsavedChanges,
    ).toBe(false);

    expect(
      dispatchBeforeUnload().defaultPrevented,
    ).toBe(false);

    unmount();
  });

  it("keeps a retryable failed save in the offline queue on close", async () => {
    const { result, unmount } =
      renderAutosave();

    await failNextSaveWith(
      new SaveNoteVersionRequestError({
        status: 503,
        code: "internal_error",
        message: "Service unavailable",
      }),
      result,
    );

    expect(
      result.current.unresolvedSave,
    ).toBe("kept-offline");

    unmount();

    expect(
      saveMocks.queueNoteVersionSave,
    ).toHaveBeenCalledWith(
      "note-1",
      actor,
      expect.objectContaining({
        baseVersionId: "version-1",
        content: editedContent,
      }),
    );
  });

  it("does not queue a save the server rejected outright", async () => {
    const { result, unmount } =
      renderAutosave();

    await failNextSaveWith(
      new SaveNoteVersionRequestError({
        status: 403,
        code: "forbidden",
        message: "Not allowed",
      }),
      result,
    );

    expect(
      result.current.unresolvedSave,
    ).toBe("will-be-lost");

    unmount();

    expect(
      saveMocks.queueNoteVersionSave,
    ).not.toHaveBeenCalled();
  });
});
