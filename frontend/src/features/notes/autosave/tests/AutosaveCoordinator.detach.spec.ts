import { afterEach, beforeEach, describe, expect, it, vi, } from "vitest";

import type { SoapContent, } from "../../../../domain/noteAttributes";
import type { SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../../../domain/noteSave";
import { AutosaveCoordinator, } from "../AutosaveCoordinator";

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
      revisionNumber: 2,
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

function createCoordinator(
  save: (
    request: SaveNoteVersionRequestBody,
  ) => Promise<SaveNoteVersionResponse>,
  overrides: Partial<
    ConstructorParameters<
      typeof AutosaveCoordinator
    >[0]
  > = {},
): AutosaveCoordinator {
  let mutationNumber = 0;

  return new AutosaveCoordinator({
    initialBaseVersionId: "version-1",
    initialContent: createInitialContent(),
    save,
    debounceMs: 500,
    createClientMutationId: () => {
      mutationNumber += 1;
      return `mutation-${mutationNumber}`;
    },
    classifyError: error =>
      error === "conflict"
        ? "conflict"
        : "save-failed",
    ...overrides,
  });
}

describe("AutosaveCoordinator.detach", () => {
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

  it("saves edits that are still inside the debounce window", async () => {
    const save = vi.fn(
      async (request: SaveNoteVersionRequestBody) =>
        createSaveResponse(request, "version-2"),
    );

    coordinator = createCoordinator(save);

    const edited = createEditedContent({
      subjective: "Typed just before leaving",
    });

    coordinator.updateDraft(edited);

    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();

    coordinator.detach();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      baseVersionId: "version-1",
      content: edited,
    });
  });

  it("lets an in-flight save finish and sends the trailing edit on the new base", async () => {
    const firstSave =
      createDeferred<SaveNoteVersionResponse>();

    const save = vi
      .fn<
        (
          request: SaveNoteVersionRequestBody,
        ) => Promise<SaveNoteVersionResponse>
      >()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementation(async request =>
        createSaveResponse(request, "version-3"),
      );

    const onStateChange = vi.fn();
    const onSaveSuccess = vi.fn();

    coordinator = createCoordinator(save, {
      onStateChange,
      onSaveSuccess,
    });

    const firstEdit = createEditedContent({
      subjective: "First edit",
    });

    coordinator.updateDraft(firstEdit);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    const trailingEdit = createEditedContent({
      subjective: "Second edit while saving",
    });

    coordinator.updateDraft(trailingEdit);
    coordinator.detach();

    onStateChange.mockClear();

    firstSave.resolve(
      createSaveResponse(
        save.mock.calls[0]![0],
        "version-2",
      ),
    );

    await flushPromises();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      baseVersionId: "version-2",
      content: trailingEdit,
    });

    expect(onStateChange).not.toHaveBeenCalled();
    expect(onSaveSuccess).not.toHaveBeenCalled();
  });

  it("hands a conflicted draft, with later edits, to onUnsavedAfterDetach", async () => {
    const save = vi.fn(
      async (): Promise<SaveNoteVersionResponse> => {
        throw "conflict";
      },
    );

    const onUnsavedAfterDetach = vi.fn();

    coordinator = createCoordinator(save, {
      onUnsavedAfterDetach,
    });

    coordinator.updateDraft(
      createEditedContent({
        subjective: "Conflicting edit",
      }),
    );

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(
      coordinator.getSnapshot().status,
    ).toBe("conflict");

    const laterEdit = createEditedContent({
      subjective: "Edited again after the conflict",
    });

    coordinator.updateDraft(laterEdit);
    coordinator.detach();

    expect(onUnsavedAfterDetach).toHaveBeenCalledTimes(1);
    expect(onUnsavedAfterDetach).toHaveBeenCalledWith({
      request: {
        baseVersionId: "version-1",
        clientMutationId: "mutation-2",
        content: laterEdit,
      },
      failureKind: "conflict",
      error: "conflict",
    });
  });

  it("hands over a save that fails after detach", async () => {
    const pendingSave =
      createDeferred<SaveNoteVersionResponse>();

    const save = vi.fn(
      () => pendingSave.promise,
    );

    const onUnsavedAfterDetach = vi.fn();

    coordinator = createCoordinator(save, {
      onUnsavedAfterDetach,
    });

    const edited = createEditedContent({
      plan: "Plan typed before a server error",
    });

    coordinator.updateDraft(edited);
    await vi.advanceTimersByTimeAsync(500);

    coordinator.detach();
    expect(onUnsavedAfterDetach).not.toHaveBeenCalled();

    const serverError = new Error("Server unavailable");
    pendingSave.reject(serverError);
    await flushPromises();

    expect(onUnsavedAfterDetach).toHaveBeenCalledWith({
      request: {
        baseVersionId: "version-1",
        clientMutationId: "mutation-1",
        content: edited,
      },
      failureKind: "save-failed",
      error: serverError,
    });
  });

  it("ignores edits after detach", async () => {
    const save = vi.fn(
      async (request: SaveNoteVersionRequestBody) =>
        createSaveResponse(request, "version-2"),
    );

    coordinator = createCoordinator(save);
    coordinator.detach();

    coordinator.updateDraft(
      createEditedContent({
        subjective: "Too late",
      }),
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(save).not.toHaveBeenCalled();
  });
});

describe("AutosaveCoordinator.flushNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts a debounced save immediately", async () => {
    const save = vi.fn(
      async (request: SaveNoteVersionRequestBody) =>
        createSaveResponse(request, "version-2"),
    );

    const coordinator = createCoordinator(save);

    coordinator.updateDraft(
      createEditedContent({
        objective: "Edited before the tab was hidden",
      }),
    );

    coordinator.flushNow();
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);

    coordinator.dispose();
  });

  it("does nothing when no save is waiting", () => {
    const save = vi.fn(
      async (request: SaveNoteVersionRequestBody) =>
        createSaveResponse(request, "version-2"),
    );

    const coordinator = createCoordinator(save);

    coordinator.flushNow();

    expect(save).not.toHaveBeenCalled();

    coordinator.dispose();
  });
});
