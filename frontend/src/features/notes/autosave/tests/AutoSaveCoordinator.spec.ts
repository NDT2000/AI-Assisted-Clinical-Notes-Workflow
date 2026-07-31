import { afterEach, beforeEach, describe, expect, it, vi, } from "vitest";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import type { SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../../../domain/noteSave";
import { AutosaveCoordinator, } from "../AutoSaveCoordinator";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>(
    (promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
}

function createInitialContent(): SoapContent {
  return {
    subjective: "Initial subjective",
    objective: "Initial objective",
    assessment: "Initial assessment",
    plan: "Initial plan",
  };
}

function createEditedContent(
  overrides: Partial<SoapContent> = {},
): SoapContent {
  return {
    ...createInitialContent(),
    ...overrides,
  };
}

function createSaveResponse(
  request: SaveNoteVersionRequestBody,
  versionId: string,
  revisionNumber: number,
): SaveNoteVersionResponse {
  return {
    clientMutationId:
      request.clientMutationId,

    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: versionId,
      assignedReviewerId: "reviewer-1",
      createdAt:
        "2026-07-31T20:00:00.000Z",
      updatedAt:
        "2026-07-31T20:30:00.000Z",
    },

    savedVersion: {
      versionId,
      noteId: "note-1",
      revisionNumber,
      parentVersionId:
        request.baseVersionId,
      content: {
        ...request.content,
      },
      authorId: "reviewer-1",
      authorRole: "REVIEWER",
      authorDisplayName:
        "Test Reviewer",
      createdAt:
        "2026-07-31T20:30:00.000Z",
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("AutosaveCoordinator", () => {
  let coordinator:
    | AutosaveCoordinator
    | null;

  beforeEach(() => {
    vi.useFakeTimers();
    coordinator = null;
  });

  afterEach(() => {
    coordinator?.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("debounces changes and saves only the latest draft", async () => {
    const onSaveSuccess = vi.fn();

    const save = vi.fn(
      async (
        request:
          SaveNoteVersionRequestBody,
      ) =>
        createSaveResponse(
          request,
          "version-2",
          2,
        ),
    );

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent:
          createInitialContent(),
        save,
        debounceMs: 500,
        createClientMutationId: () =>
          "mutation-1",
        onSaveSuccess,
      });

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "First subjective edit",
      }),
    );

    await vi.advanceTimersByTimeAsync(
      250,
    );

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "Latest subjective edit",
        plan: "Latest plan edit",
      }),
    );

    await vi.advanceTimersByTimeAsync(
      499,
    );

    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      1,
    );

    expect(save).toHaveBeenCalledTimes(
      1,
    );

    expect(save).toHaveBeenCalledWith({
      baseVersionId: "version-1",
      clientMutationId: "mutation-1",
      content: {
        subjective:
          "Latest subjective edit",
        objective:
          "Initial objective",
        assessment:
          "Initial assessment",
        plan: "Latest plan edit",
      },
    });

    expect(onSaveSuccess).toHaveBeenCalledWith({
      response: expect.objectContaining({
        clientMutationId:
          "mutation-1",
      }),
      savedContent: {
        subjective:
          "Latest subjective edit",
        objective:
          "Initial objective",
        assessment:
          "Initial assessment",
        plan: "Latest plan edit",
      },
    });

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "idle",
      hasPendingChanges: false,
      error: null,
    });
  });

  it("cancels the pending save when content is restored before the debounce ends", async () => {
    const save = vi.fn(
      async (
        request:
          SaveNoteVersionRequestBody,
      ) =>
        createSaveResponse(
          request,
          "version-2",
          2,
        ),
    );

    const initialContent =
      createInitialContent();

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent,
        save,
        debounceMs: 500,
        createClientMutationId: () =>
          "mutation-1",
      });

    coordinator.updateDraft({
      ...initialContent,
      subjective:
        "Temporary subjective edit",
    });

    expect(
      coordinator.getSnapshot().status,
    ).toBe("changes-pending");

    await vi.advanceTimersByTimeAsync(
      250,
    );

    coordinator.updateDraft(
      initialContent,
    );

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "idle",
      hasPendingChanges: false,
      error: null,
    });

    await vi.advanceTimersByTimeAsync(
      500,
    );

    expect(save).not.toHaveBeenCalled();
  });

  it("allows one in-flight save and keeps only the latest trailing draft", async () => {
    const firstSave =
      createDeferred<SaveNoteVersionResponse>();

    const secondSave =
      createDeferred<SaveNoteVersionResponse>();

    let saveNumber = 0;

    const save = vi.fn(
      (
        _request:
          SaveNoteVersionRequestBody,
      ) => {
        saveNumber += 1;

        return saveNumber === 1
          ? firstSave.promise
          : secondSave.promise;
      },
    );

    let mutationNumber = 0;

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent:
          createInitialContent(),
        save,
        debounceMs: 500,
        createClientMutationId: () => {
          mutationNumber += 1;
          return `mutation-${mutationNumber}`;
        },
      });

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "First saved edit",
      }),
    );

    await vi.advanceTimersByTimeAsync(
      500,
    );

    expect(save).toHaveBeenCalledTimes(
      1,
    );

    const firstRequest =
      save.mock.calls[0]?.[0];

    if (!firstRequest) {
      throw new Error(
        "Expected the first save request.",
      );
    }

    expect(firstRequest).toEqual({
      baseVersionId: "version-1",
      clientMutationId: "mutation-1",
      content: {
        subjective:
          "First saved edit",
        objective:
          "Initial objective",
        assessment:
          "Initial assessment",
        plan: "Initial plan",
      },
    });

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "Intermediate edit",
      }),
    );

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "Latest trailing edit",
        assessment:
          "Latest assessment edit",
      }),
    );

    expect(save).toHaveBeenCalledTimes(
      1,
    );

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "saving",
      hasPendingChanges: true,
      error: null,
    });

    firstSave.resolve(
      createSaveResponse(
        firstRequest,
        "version-2",
        2,
      ),
    );

    await flushPromises();

    expect(save).toHaveBeenCalledTimes(
      2,
    );

    const secondRequest =
      save.mock.calls[1]?.[0];

    if (!secondRequest) {
      throw new Error(
        "Expected the trailing save request.",
      );
    }

    expect(secondRequest).toEqual({
      baseVersionId: "version-2",
      clientMutationId: "mutation-2",
      content: {
        subjective:
          "Latest trailing edit",
        objective:
          "Initial objective",
        assessment:
          "Latest assessment edit",
        plan: "Initial plan",
      },
    });

    secondSave.resolve(
      createSaveResponse(
        secondRequest,
        "version-3",
        3,
      ),
    );

    await flushPromises();

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "idle",
      hasPendingChanges: false,
      error: null,
    });
  });

  it("retries the exact failed request with the same mutation ID", async () => {
    const firstSave =
      createDeferred<SaveNoteVersionResponse>();

    const retrySave =
      createDeferred<SaveNoteVersionResponse>();

    let saveNumber = 0;

    const save = vi.fn(
      (
        _request:
          SaveNoteVersionRequestBody,
      ) => {
        saveNumber += 1;

        return saveNumber === 1
          ? firstSave.promise
          : retrySave.promise;
      },
    );

    const createClientMutationId =
      vi.fn(() => "mutation-retry-1");

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent:
          createInitialContent(),
        save,
        debounceMs: 500,
        createClientMutationId,
      });

    coordinator.updateDraft(
      createEditedContent({
        plan: "Updated plan",
      }),
    );

    await vi.advanceTimersByTimeAsync(
      500,
    );

    const firstRequest =
      save.mock.calls[0]?.[0];

    if (!firstRequest) {
      throw new Error(
        "Expected the initial save request.",
      );
    }

    const saveError = new Error(
      "The save request failed.",
    );

    firstSave.reject(saveError);

    await flushPromises();

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "save-failed",
      hasPendingChanges: true,
      error: saveError,
    });

    coordinator.retry();

    expect(save).toHaveBeenCalledTimes(
      2,
    );

    const retryRequest =
      save.mock.calls[1]?.[0];

    expect(retryRequest).toEqual(
      firstRequest,
    );

    expect(
      retryRequest?.clientMutationId,
    ).toBe("mutation-retry-1");

    expect(
      createClientMutationId,
    ).toHaveBeenCalledTimes(1);

    if (!retryRequest) {
      throw new Error(
        "Expected the retry request.",
      );
    }

    retrySave.resolve(
      createSaveResponse(
        retryRequest,
        "version-2",
        2,
      ),
    );

    await flushPromises();

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "idle",
      hasPendingChanges: false,
      error: null,
    });
  });

  it("enters conflict state and does not automatically retry", async () => {
    const conflictError = new Error(
      "The base version is stale.",
    );

    const save = vi.fn(
      async (
        _request:
          SaveNoteVersionRequestBody,
      ) => {
        throw conflictError;
      },
    );

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent:
          createInitialContent(),
        save,
        debounceMs: 500,
        createClientMutationId: () =>
          "mutation-conflict-1",
        classifyError: (error) =>
          error === conflictError
            ? "conflict"
            : "save-failed",
      });

    coordinator.updateDraft(
      createEditedContent({
        assessment:
          "Conflicting assessment",
      }),
    );

    await vi.advanceTimersByTimeAsync(
      500,
    );

    expect(save).toHaveBeenCalledTimes(
      1,
    );

    expect(
      coordinator.getSnapshot(),
    ).toEqual({
      status: "conflict",
      hasPendingChanges: true,
      error: conflictError,
    });

    coordinator.retry();

    expect(save).toHaveBeenCalledTimes(
      1,
    );
  });

  it("does not save after it has been disposed", async () => {
    const save = vi.fn(
      async (
        request:
          SaveNoteVersionRequestBody,
      ) =>
        createSaveResponse(
          request,
          "version-2",
          2,
        ),
    );

    coordinator =
      new AutosaveCoordinator({
        initialBaseVersionId:
          "version-1",
        initialContent:
          createInitialContent(),
        save,
        debounceMs: 500,
        createClientMutationId: () =>
          "mutation-1",
      });

    coordinator.updateDraft(
      createEditedContent({
        subjective:
          "Unsaved subjective",
      }),
    );

    coordinator.dispose();

    await vi.advanceTimersByTimeAsync(
      500,
    );

    expect(save).not.toHaveBeenCalled();
  });
});