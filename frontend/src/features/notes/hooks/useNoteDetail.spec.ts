import { act, renderHook, waitFor, } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, } from "vitest";

import type { NoteDetail, NoteVersionDetail, } from "../../../domain/noteDetail";

vi.mock("../api/getNoteDetail", async () => {
  const actual =
    await vi.importActual<
      typeof import("../api/getNoteDetail")
    >("../api/getNoteDetail");

  return {
    ...actual,
    getNoteDetail: vi.fn(),
  };
});

import { getNoteDetail, NoteDetailRequestError, } from "../api/getNoteDetail";
import { useNoteDetail } from "./useNoteDetail";

const getNoteDetailMock =
  vi.mocked(getNoteDetail);

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

function createNoteDetail(
  noteId: string,
): NoteDetail {
  const createdAt =
    "2026-07-29T10:00:00.000Z";

  const updatedAt =
    "2026-07-29T10:30:00.000Z";

  const currentVersion:
    NoteVersionDetail = {
      versionId: `${noteId}-version-1`,
      noteId,
      revisionNumber: 1,
      parentVersionId: null,

      content: {
        subjective:
          "Patient reports improved symptoms.",
        objective:
          "Vital signs are stable.",
        assessment:
          "Condition is improving.",
        plan:
          "Continue the current care plan.",
      },

      authorId: "clinician-1",
      authorRole: "CLINICIAN",
      authorDisplayName:
        "Dr. Maya Brooks",
      createdAt,
    };

  return {
    note: {
      id: noteId,
      patientId: "patient-1",
      sessionId: "session-1",
      status: "READY_FOR_REVIEW",
      currentVersionId:
        currentVersion.versionId,
      assignedReviewerId:
        "reviewer-1",
      createdAt,
      updatedAt,
    },

    patient: {
      id: "patient-1",
      displayName: "Patient One",
      dateOfBirth: "1990-01-01",
      medicalRecordNumber:
        "MRN-0000001",
    },

    session: {
      id: "session-1",
      startedAt:
        "2026-07-29T09:00:00.000Z",
      endedAt:
        "2026-07-29T09:45:00.000Z",

      clinician: {
        id: "clinician-1",
        displayName:
          "Dr. Maya Brooks",
        role: "CLINICIAN",
      },
    },

    assignedReviewer: {
      id: "reviewer-1",
      displayName: "Alex Reviewer",
      role: "REVIEWER",
    },

    currentVersion,
    versions: [currentVersion],
    timeline: [],
    presence: [],
  };
}

describe("useNoteDetail", () => {
  beforeEach(() => {
    getNoteDetailMock.mockReset();
  });

  it("loads note detail successfully", async () => {
    const note =
      createNoteDetail("note-1");

    getNoteDetailMock.mockResolvedValueOnce(
      note,
    );

    const { result } = renderHook(() =>
      useNoteDetail(
        "note-1",
        "REVIEWER",
      ),
    );

    expect(
      result.current.state.status,
    ).toBe("loading");

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note,
        message: null,
      });
    });

    expect(
      getNoteDetailMock,
    ).toHaveBeenCalledWith(
      "note-1",
      "REVIEWER",
      expect.any(AbortSignal),
    );
  });

  it("returns not-found without requesting when the note ID is missing", () => {
    const { result } = renderHook(() =>
      useNoteDetail(
        undefined,
        "REVIEWER",
      ),
    );

    expect(
      result.current.state,
    ).toEqual({
      status: "not-found",
      note: null,
      message:
        "No note ID was provided.",
    });

    expect(
      getNoteDetailMock,
    ).not.toHaveBeenCalled();
  });

  it("maps a 403 response to unauthorized", async () => {
    getNoteDetailMock.mockRejectedValueOnce(
      new NoteDetailRequestError({
        status: 403,
        code: "forbidden",
        message:
          "You are not authorized to view this note.",
      }),
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
        status: "unauthorized",
        note: null,
        message:
          "You are not authorized to view this note.",
      });
    });
  });

  it("maps a 404 response to not-found", async () => {
    getNoteDetailMock.mockRejectedValueOnce(
      new NoteDetailRequestError({
        status: 404,
        code: "not_found",
        message:
          "Note note-1 was not found.",
      }),
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
        status: "not-found",
        note: null,
        message:
          "Note note-1 was not found.",
      });
    });
  });

  it("maps other request failures to the error state", async () => {
    getNoteDetailMock.mockRejectedValueOnce(
      new NoteDetailRequestError({
        status: 503,
        code: "internal_error",
        message:
          "Simulated network failure.",
      }),
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
          "Simulated network failure.",
      });
    });
  });

  it("can retry a failed request", async () => {
    const note =
      createNoteDetail("note-1");

    getNoteDetailMock
      .mockRejectedValueOnce(
        new NoteDetailRequestError({
          status: 503,
          code: "internal_error",
          message:
            "Simulated network failure.",
        }),
      )
      .mockResolvedValueOnce(note);

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
      });
    });

    expect(
      getNoteDetailMock,
    ).toHaveBeenCalledTimes(2);
  });

  it("aborts the previous request and ignores its stale response", async () => {
    const firstRequest =
      createDeferred<NoteDetail>();

    const secondRequest =
      createDeferred<NoteDetail>();

    let firstSignal:
      | AbortSignal
      | undefined;

    getNoteDetailMock
      .mockImplementationOnce(
        (
          _noteId,
          _actorRole,
          signal,
        ) => {
          firstSignal = signal;

          return firstRequest.promise;
        },
      )
      .mockImplementationOnce(() =>
        secondRequest.promise,
      );

    interface HookProps {
      noteId: string | undefined;
    }

    const { result, rerender } =
      renderHook(
        ({ noteId }: HookProps) =>
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

    expect(
      getNoteDetailMock,
    ).toHaveBeenCalledTimes(1);

    rerender({
      noteId: "note-2",
    });

    expect(firstSignal?.aborted).toBe(
      true,
    );

    expect(
      getNoteDetailMock,
    ).toHaveBeenCalledTimes(2);

    const secondNote =
      createNoteDetail("note-2");

    await act(async () => {
      secondRequest.resolve(secondNote);
      await secondRequest.promise;
    });

    await waitFor(() => {
      expect(
        result.current.state,
      ).toEqual({
        status: "success",
        note: secondNote,
        message: null,
      });
    });

    const firstNote =
      createNoteDetail("note-1");

    await act(async () => {
      firstRequest.resolve(firstNote);
      await firstRequest.promise;
    });

    expect(
      result.current.state,
    ).toEqual({
      status: "success",
      note: secondNote,
      message: null,
    });
  });
});