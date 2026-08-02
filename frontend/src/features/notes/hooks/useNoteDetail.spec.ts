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

import type {
  NoteDetail,
  NoteVersionDetail,
} from "../../../domain/noteDetail";

import {
  NoteDetailRequestError,
} from "../api/getNoteDetail";

import {
  readNoteDetail,
  type NoteDetailReadResult,
} from "../offline/readNoteDetail";

import {
  useNoteDetail,
} from "./useNoteDetail";

vi.mock(
  "../offline/readNoteDetail",
  async () => {
    const actual =
      await vi.importActual<
        typeof import(
          "../offline/readNoteDetail"
        )
      >("../offline/readNoteDetail");

    return {
      ...actual,
      readNoteDetail: vi.fn(),
    };
  },
);

const readNoteDetailMock =
  vi.mocked(readNoteDetail);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (
    value: T,
  ) => void;

  let rejectPromise!: (
    reason?: unknown,
  ) => void;

  const promise = new Promise<T>(
    (resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createVersion(
  noteId: string,
  revisionNumber = 1,
): NoteVersionDetail {
  const versionId =
    `${noteId}-version-${revisionNumber}`;

  return {
    versionId,
    noteId,
    revisionNumber,

    parentVersionId:
      revisionNumber > 1
        ? `${noteId}-version-${revisionNumber - 1}`
        : null,

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

    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName: "Dr. Clinician",

    createdAt:
      "2026-08-01T12:00:00.000Z",
  };
}

function createNoteDetail(
  noteId: string,
  revisionNumber = 1,
): NoteDetail {
  const currentVersion = createVersion(
    noteId,
    revisionNumber,
  );

  return {
    note: {
      id: noteId,

      patientId:
        `${noteId}-patient`,

      sessionId:
        `${noteId}-session`,

      status: "IN_REVIEW",

      currentVersionId:
        currentVersion.versionId,

      assignedReviewerId:
        "reviewer-1",

      createdAt:
        "2026-08-01T11:00:00.000Z",

      updatedAt:
        "2026-08-01T12:00:00.000Z",
    },

    patient: {
      id: `${noteId}-patient`,
      displayName: "Test Patient",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber: "MRN-TEST",
    },

    session: {
      id: `${noteId}-session`,

      startedAt:
        "2026-08-01T10:00:00.000Z",

      endedAt:
        "2026-08-01T10:30:00.000Z",

      clinician: {
        id: "clinician-1",
        displayName: "Dr. Clinician",
        role: "CLINICIAN",
      },
    },

    assignedReviewer: {
      id: "reviewer-1",
      displayName: "Dr. Reviewer",
      role: "REVIEWER",
    },

    currentVersion,

    versions: [
      currentVersion,
    ],

    timeline: [],

    presence: [],
  };
}

beforeEach(() => {
  readNoteDetailMock.mockReset();
});

describe("useNoteDetail", () => {
  it("starts in the loading state", () => {
    const request =
      createDeferred<NoteDetailReadResult>();

    readNoteDetailMock.mockReturnValueOnce(
      request.promise,
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    expect(result.current.state).toEqual({
      status: "loading",
      note: null,
      message: null,
    });
  });

  it("loads note details from the network", async () => {
    const note =
      createNoteDetail("note-1");

    readNoteDetailMock.mockResolvedValueOnce({
      note,
      source: "network",
      cachedAt: null,
    });

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note,
        message: null,
        source: "network",
        cachedAt: null,
      });
    });

    expect(
      readNoteDetailMock,
    ).toHaveBeenCalledTimes(1);

    expect(
      readNoteDetailMock,
    ).toHaveBeenCalledWith(
      "note-1",
      "REVIEWER",
      expect.any(AbortSignal),
    );
  });

  it("exposes when note details came from the offline cache", async () => {
    const note =
      createNoteDetail("note-1");

    readNoteDetailMock.mockResolvedValueOnce({
      note,
      source: "cache",
      cachedAt: 1_722_528_000_000,
    });

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note,
        message: null,
        source: "cache",
        cachedAt: 1_722_528_000_000,
      });
    });
  });

  it("returns not-found when no note ID is provided", async () => {
    const { result } = renderHook(() =>
      useNoteDetail(
        undefined,
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "not-found",
        note: null,
        message:
          "No note ID was provided.",
      });
    });

    expect(
      readNoteDetailMock,
    ).not.toHaveBeenCalled();
  });

  it("returns unauthorized for a 403 response", async () => {
    const requestError =
      new NoteDetailRequestError({
        status: 403,
        code: "forbidden",
        message:
          "You are not authorized to view this note.",
      });

    readNoteDetailMock.mockRejectedValueOnce(
      requestError,
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "READONLY_AUDITOR",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "unauthorized",
        note: null,
        message:
          "You are not authorized to view this note.",
      });
    });
  });

  it("returns not-found for a 404 response", async () => {
    const requestError =
      new NoteDetailRequestError({
        status: 404,
        code: "not_found",
        message:
          "The requested note was not found.",
      });

    readNoteDetailMock.mockRejectedValueOnce(
      requestError,
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "missing-note",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "not-found",
        note: null,
        message:
          "The requested note was not found.",
      });
    });
  });

  it("returns the request error message for other HTTP errors", async () => {
    const requestError =
      new NoteDetailRequestError({
        status: 503,
        code: "internal_error",
        message:
          "Simulated server failure.",
      });

    readNoteDetailMock.mockRejectedValueOnce(
      requestError,
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "error",
        note: null,
        message:
          "Simulated server failure.",
      });
    });
  });

  it("returns a generic message for an unknown error", async () => {
    readNoteDetailMock.mockRejectedValueOnce(
      new Error("Unexpected failure"),
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "error",
        note: null,
        message:
          "Unable to load note details.",
      });
    });
  });

  it("retries the note-detail request", async () => {
    const note =
      createNoteDetail("note-1");

    readNoteDetailMock
      .mockRejectedValueOnce(
        new NoteDetailRequestError({
          status: 503,
          code: "internal_error",
          message:
            "Simulated server failure.",
        }),
      )
      .mockResolvedValueOnce({
        note,
        source: "network",
        cachedAt: null,
      });

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    await waitFor(() => {
      expect(
        result.current.state.status,
      ).toBe("error");
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note,
        message: null,
        source: "network",
        cachedAt: null,
      });
    });

    expect(
      readNoteDetailMock,
    ).toHaveBeenCalledTimes(2);
  });

  it("does not allow an older request to replace a newer note", async () => {
    const firstNote =
      createNoteDetail("note-1");

    const secondNote =
      createNoteDetail("note-2");

    const firstRequest =
      createDeferred<NoteDetailReadResult>();

    const secondRequest =
      createDeferred<NoteDetailReadResult>();

    readNoteDetailMock
      .mockReturnValueOnce(
        firstRequest.promise,
      )
      .mockReturnValueOnce(
        secondRequest.promise,
      );

    const { result, rerender } =
      renderHook(
        ({
          noteId,
        }: {
          noteId: string;
        }) =>
          useNoteDetail(
            noteId,
            "REVIEWER",
          ),
        {
          initialProps: {
            noteId: "note-1",
          },
        },
      );

    rerender({
      noteId: "note-2",
    });

    await act(async () => {
      secondRequest.resolve({
        note: secondNote,
        source: "network",
        cachedAt: null,
      });

      await secondRequest.promise;
    });

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note: secondNote,
        message: null,
        source: "network",
        cachedAt: null,
      });
    });

    await act(async () => {
      firstRequest.resolve({
        note: firstNote,
        source: "cache",
        cachedAt: 100,
      });

      await firstRequest.promise;
    });

    expect(
      result.current.state,
    ).toEqual({
      status: "success",
      note: secondNote,
      message: null,
      source: "network",
      cachedAt: null,
    });
  });

  it("aborts the active request when the hook unmounts", () => {
    const request =
      createDeferred<NoteDetailReadResult>();

    readNoteDetailMock.mockReturnValueOnce(
      request.promise,
    );

    const { unmount } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    const signal =
      readNoteDetailMock.mock.calls[0]?.[2];

    expect(signal).toBeInstanceOf(
      AbortSignal,
    );

    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});