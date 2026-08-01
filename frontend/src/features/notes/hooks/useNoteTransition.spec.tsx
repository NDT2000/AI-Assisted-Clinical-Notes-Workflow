import { act, renderHook, } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, } from "vitest";

import type { TransitionNoteActor, TransitionNoteCommand, TransitionNoteResponse, } from "../../../domain/noteTransition";
import { useNoteTransition, } from "./useNoteTransition";

const apiMocks = vi.hoisted(() => ({
  transitionNote: vi.fn(),
}));

vi.mock(
  "../api/transitionNote",
  () => ({
    transitionNote:
      apiMocks.transitionNote,

    TransitionNoteRequestError:
      class TransitionNoteRequestError
        extends Error {},
  }),
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve:
    | ((value: T) => void)
    | undefined;

  let reject:
    | ((reason?: unknown) => void)
    | undefined;

  const promise = new Promise<T>(
    (
      promiseResolve,
      promiseReject,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  if (!resolve || !reject) {
    throw new Error(
      "Unable to create deferred promise.",
    );
  }

  return {
    promise,
    resolve,
    reject,
  };
}

const actor: TransitionNoteActor = {
  id: "reviewer-1",
  displayName: "Test Reviewer",
  role: "REVIEWER",
};

const command: TransitionNoteCommand = {
  baseVersionId: "version-1",
  trigger: "START_REVIEW",
};

const response: TransitionNoteResponse = {
  clientMutationId:
    "transition-mutation-1",

  note: {
    id: "note-1",
    patientId: "patient-1",
    sessionId: "session-1",
    status: "IN_REVIEW",
    currentVersionId: "version-1",
    assignedReviewerId:
      "reviewer-1",
    createdAt:
      "2026-08-01T15:00:00.000Z",
    updatedAt:
      "2026-08-01T16:00:00.000Z",
  },

  currentVersion: {
    versionId: "version-1",
    noteId: "note-1",
    revisionNumber: 1,
    parentVersionId: null,
    content: {
      subjective: "Subjective",
      objective: "Objective",
      assessment: "Assessment",
      plan: "Plan",
    },
    authorId: "clinician-1",
    authorRole: "CLINICIAN",
    authorDisplayName:
      "Test Clinician",
    createdAt:
      "2026-08-01T15:00:00.000Z",
  },

  timelineEvent: {
    eventId: "event-1",
    noteId: "note-1",
    versionId: "version-1",
    fromStatus:
      "READY_FOR_REVIEW",
    toStatus: "IN_REVIEW",
    actorId: actor.id,
    actorRole: actor.role,
    actorDisplayName:
      actor.displayName,
    occurredAt:
      "2026-08-01T16:00:00.000Z",
  },
};

describe("useNoteTransition", () => {
  beforeEach(() => {
    apiMocks.transitionNote.mockReset();
  });

  it(
    "blocks a duplicate execution while the first request is pending",
    async () => {
      const deferred =
        createDeferred<
          TransitionNoteResponse
        >();

      apiMocks.transitionNote.mockReturnValue(
        deferred.promise,
      );

      const onOptimisticApply =
        vi.fn();

      const onSuccess = vi.fn();
      const onFailure = vi.fn();

      const { result } = renderHook(
        () =>
          useNoteTransition({
            noteId: "note-1",
            actor,
            onOptimisticApply,
            onSuccess,
            onFailure,
          }),
      );

      let firstRequest:
        | Promise<
            TransitionNoteResponse | null
          >
        | undefined;

      act(() => {
        firstRequest =
          result.current.execute(
            command,
          );
      });

      expect(
        result.current.state.status,
      ).toBe("pending");

      let duplicateResult:
        | TransitionNoteResponse
        | null
        | undefined;

      await act(async () => {
        duplicateResult =
          await result.current.execute(
            command,
          );
      });

      expect(duplicateResult).toBeNull();

      expect(
        apiMocks.transitionNote,
      ).toHaveBeenCalledTimes(1);

      expect(
        onOptimisticApply,
      ).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferred.resolve(response);
        await firstRequest;
      });

      expect(
        result.current.state.status,
      ).toBe("succeeded");

      expect(onSuccess).toHaveBeenCalledWith(
        response,
      );

      expect(onFailure).not.toHaveBeenCalled();
    },
  );
});