import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, } from "vitest";
import { setupServer } from "msw/node";

import type { TransitionNoteRequestBody, TransitionNoteResponse, TransitionNoteStandardErrorResponse, } from "../../domain/noteTransition";
import type { NoteSummary } from "../../domain/noteSummary";

vi.mock("../mockNetwork", async () => {
  const actual =
    await vi.importActual<
      typeof import("../mockNetwork")
    >("../mockNetwork");

  return {
    ...actual,
    simulateNetwork: vi.fn(),
  };
});

import { devFailureControls } from "../devFailureControls";
import { simulateNetwork } from "../mockNetwork";
import {
  getNoteDetail,
  getNotes,
  seedNotes,
} from "../noteStore";
import { transitionNoteHandler } from "../transitionNoteHandler";

const server = setupServer(
  transitionNoteHandler,
);

const simulateNetworkMock =
  vi.mocked(simulateNetwork);

function requireReadyForReviewNote(): NoteSummary {
  const note = getNotes().find(
    (candidate) =>
      candidate.status ===
      "READY_FOR_REVIEW",
  );

  if (!note) {
    throw new Error(
      "Expected a READY_FOR_REVIEW note in the seeded dataset.",
    );
  }

  return note;
}

function getActorHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "x-actor-id": "reviewer-test",
    "x-actor-role": "REVIEWER",
    "x-actor-display-name":
      "Test Reviewer",
    "x-mfa-verified": "true",
  };
}

function createTransitionRequestBody(
  noteId: string,
  clientMutationId: string,
): TransitionNoteRequestBody {
  const detail = getNoteDetail(noteId);

  if (!detail) {
    throw new Error(
      `Expected note detail for ${noteId}.`,
    );
  }

  return {
    baseVersionId:
      detail.currentVersion.versionId,
    trigger: "START_REVIEW",
    clientMutationId,
  };
}

function postTransition(
  noteId: string,
  body: unknown,
): Promise<Response> {
  return fetch(
    `http://localhost/api/notes/${noteId}/transitions`,
    {
      method: "POST",
      headers: getActorHeaders(),
      body: JSON.stringify(body),
    },
  );
}

describe(
  "transitionNoteHandler development controls",
  () => {
    beforeAll(() => {
      server.listen({
        onUnhandledRequest: "error",
      });
    });

    beforeEach(() => {
      seedNotes(100, 42);
      devFailureControls.reset();

      simulateNetworkMock.mockReset();
      simulateNetworkMock.mockResolvedValue(
        undefined,
      );
    });

    afterEach(() => {
      devFailureControls.reset();
      server.resetHandlers();
    });

    afterAll(() => {
      server.close();
    });

    it(
      "rejects only the next valid transition",
      async () => {
        const note =
          requireReadyForReviewNote();

        const originalDetail =
          getNoteDetail(note.id);

        if (!originalDetail) {
          throw new Error(
            "Expected note detail.",
          );
        }

        const originalTimelineLength =
          originalDetail.timeline.length;

        devFailureControls
          .armRejectNextTransition();

        const rejectedResponse =
          await postTransition(
            note.id,
            createTransitionRequestBody(
              note.id,
              "mutation-dev-rejection-1",
            ),
          );

        expect(
          rejectedResponse.status,
        ).toBe(422);

        const rejectedBody =
          (await rejectedResponse.json()) as
            TransitionNoteStandardErrorResponse;

        expect(rejectedBody).toEqual({
          error:
            "transition_not_allowed",
          message:
            "Development control: the next transition was intentionally rejected.",
        });

        expect(
          devFailureControls
            .getSnapshot()
            .rejectNextTransition,
        ).toBe(false);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();

        const detailAfterRejection =
          getNoteDetail(note.id);

        expect(
          detailAfterRejection?.note.status,
        ).toBe("READY_FOR_REVIEW");

        expect(
          detailAfterRejection?.timeline,
        ).toHaveLength(
          originalTimelineLength,
        );

        const followingResponse =
          await postTransition(
            note.id,
            createTransitionRequestBody(
              note.id,
              "mutation-after-dev-rejection-1",
            ),
          );

        expect(
          followingResponse.status,
        ).toBe(200);

        const followingBody =
          (await followingResponse.json()) as
            TransitionNoteResponse;

        expect(
          followingBody.note.status,
        ).toBe("IN_REVIEW");

        expect(
          followingBody.timelineEvent
            .fromStatus,
        ).toBe("READY_FOR_REVIEW");

        expect(
          followingBody.timelineEvent
            .toStatus,
        ).toBe("IN_REVIEW");

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "does not consume the rejection control for an invalid request",
      async () => {
        const note =
          requireReadyForReviewNote();

        devFailureControls
          .armRejectNextTransition();

        const invalidResponse =
          await postTransition(
            note.id,
            {
              baseVersionId: "",
              trigger:
                "START_REVIEW",
            },
          );

        expect(
          invalidResponse.status,
        ).toBe(400);

        expect(
          devFailureControls
            .getSnapshot()
            .rejectNextTransition,
        ).toBe(true);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();

        const rejectedResponse =
          await postTransition(
            note.id,
            createTransitionRequestBody(
              note.id,
              "mutation-after-invalid-request-1",
            ),
          );

        expect(
          rejectedResponse.status,
        ).toBe(422);

        expect(
          devFailureControls
            .getSnapshot()
            .rejectNextTransition,
        ).toBe(false);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );
  },
);