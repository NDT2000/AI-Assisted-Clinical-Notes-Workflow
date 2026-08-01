import { waitFor, act, cleanup, renderHook, } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, } from "vitest";

import type { TransitionNoteActor, TransitionNoteCommand, TransitionNoteResponse, } from "../../../domain/noteTransition";
import { transitionNote } from "../api/transitionNote";
import { useNoteTransition } from "./useNoteTransition";

vi.mock(
  "../api/transitionNote",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../api/transitionNote")
      >();

    return {
      ...actual,
      transitionNote: vi.fn(),
    };
  },
);

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

const actor: TransitionNoteActor = {
  id: "reviewer-1",
  displayName: "Current Reviewer",
  role: "REVIEWER",
  mfaVerified: true,
};

const command: TransitionNoteCommand = {
  baseVersionId: "version-1",
  trigger: "START_REVIEW",
};

function createTransitionResponse(): TransitionNoteResponse {
  return {
    clientMutationId: "transition-mutation-1",

    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: "version-1",
      assignedReviewerId: actor.id,
      createdAt: "2026-07-31T20:00:00.000Z",
      updatedAt: "2026-07-31T20:05:00.000Z",
    },

    currentVersion: {
      versionId: "version-1",
      noteId: "note-1",
      revisionNumber: 1,
      parentVersionId: null,

      content: {
        subjective: "Subjective content",
        objective: "Objective content",
        assessment: "Assessment content",
        plan: "Plan content",
      },

      authorId: "clinician-1",
      authorRole: "CLINICIAN",
      authorDisplayName: "Test Clinician",
      createdAt: "2026-07-31T20:00:00.000Z",
    },

    timelineEvent: {
      eventId: "transition-event-1",
      noteId: "note-1",
      versionId: "version-1",
      fromStatus: "READY_FOR_REVIEW",
      toStatus: "IN_REVIEW",
      actorId: actor.id,
      actorRole: actor.role,
      actorDisplayName: actor.displayName,
      occurredAt: "2026-07-31T20:05:00.000Z",
    },
  };
}

afterEach(() => {
  cleanup();
});

describe("useNoteTransition", () => {
  beforeEach(() => {
    vi.mocked(transitionNote).mockReset();
  });

  it(
    "blocks a duplicate execution while a transition request is pending",
    async () => {
      const deferred =
        createDeferred<TransitionNoteResponse>();

      vi.mocked(
        transitionNote,
      ).mockReturnValueOnce(deferred.promise);

      const onOptimisticApply = vi.fn();
      const onSuccess = vi.fn();
      const onFailure = vi.fn();

      const { result } = renderHook(() =>
        useNoteTransition({
          noteId: "note-1",
          actor,
          onOptimisticApply,
          onSuccess,
          onFailure,
        }),
      );

      let firstExecution!: Promise<
        TransitionNoteResponse | null
      >;

      act(() => {
        firstExecution =
          result.current.execute(command);
      });

      await waitFor(() => {
        expect(
          result.current.state.status,
        ).toBe("pending");
      });

      let secondResult:
        | TransitionNoteResponse
        | null = null;

      await act(async () => {
        secondResult =
          await result.current.execute(command);
      });

      expect(secondResult).toBeNull();

      expect(
        transitionNote,
      ).toHaveBeenCalledTimes(1);

      expect(
        onOptimisticApply,
      ).toHaveBeenCalledTimes(1);

      expect(
        onOptimisticApply,
      ).toHaveBeenCalledWith(command);

      const response =
        createTransitionResponse();

      await act(async () => {
        deferred.resolve(response);
        await firstExecution;
      });

      await waitFor(() => {
        expect(
          result.current.state.status,
        ).toBe("succeeded");
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(
        response,
      );

      expect(onFailure).not.toHaveBeenCalled();
    },
  );
});