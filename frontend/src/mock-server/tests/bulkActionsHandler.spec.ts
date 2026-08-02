import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  setupServer,
} from "msw/node";

import type {
  NoteSummary,
} from "../../domain/noteSummary";
import type {
  TransitionNoteActor,
} from "../../domain/noteTransition";

vi.mock(
  "../mockNetwork",
  async () => {
    const actual =
      await vi.importActual<
        typeof import("../mockNetwork")
      >("../mockNetwork");

    return {
      ...actual,
      simulateNetwork:
        vi.fn(),
    };
  },
);

import {
  SimulatedNetworkFailure,
  simulateNetwork,
} from "../mockNetwork";
import {
  assignReviewerHandler,
  regenerateHandler,
} from "../bulkActionsHandler";
import {
  getNoteDetail,
  getNotes,
  seedNotes,
} from "../noteStore";

const server =
  setupServer(
    assignReviewerHandler,
    regenerateHandler,
  );

const simulateNetworkMock =
  vi.mocked(
    simulateNetwork,
  );

interface ErrorResponse {
  error: string;
  message: string;
}

function requireSummary(
  predicate: (
    note: NoteSummary,
  ) => boolean,
): NoteSummary {
  const summary =
    getNotes().find(predicate);

  if (!summary) {
    throw new Error(
      "Expected a matching note summary.",
    );
  }

  return summary;
}

function createActor(
  role:
    TransitionNoteActor["role"],
): TransitionNoteActor {
  return {
    id:
      `${role.toLowerCase()}-handler`,
    displayName:
      `${role} Handler`,
    role,
  };
}

function getActorHeaders(
  actor:
    TransitionNoteActor,
): HeadersInit {
  return {
    "content-type":
      "application/json",
    "x-actor-id": actor.id,
    "x-actor-role":
      actor.role,
    "x-actor-display-name":
      actor.displayName,
  };
}

describe(
  "bulk action authorization",
  () => {
    beforeAll(() => {
      server.listen({
        onUnhandledRequest:
          "error",
      });
    });

    beforeEach(() => {
      seedNotes(500, 42);

      simulateNetworkMock
        .mockReset();

      simulateNetworkMock
        .mockResolvedValue(
          undefined,
        );
    });

    afterEach(() => {
      server.resetHandlers();
    });

    afterAll(() => {
      server.close();
    });

    it(
      "allows a clinician to assign a reviewer to an eligible note",
      async () => {
        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/assign-reviewer",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "CLINICIAN",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    ready.id,
                  ],
                  reviewerId:
                    "reviewer-assigned",
                  reviewerDisplayName:
                    "Assigned Reviewer",
                }),
            },
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          await response.json(),
        ).toEqual({
          updated: [
            ready.id,
          ],
        });

        expect(
          getNoteDetail(
            ready.id,
          )?.assignedReviewer,
        ).toEqual({
          id:
            "reviewer-assigned",
          displayName:
            "Assigned Reviewer",
          role: "REVIEWER",
        });
      },
    );

    it(
      "updates only assignment-eligible notes in a mixed request",
      async () => {
        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const inReview =
          requireSummary(
            note =>
              note.status ===
              "IN_REVIEW",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/assign-reviewer",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "ADMIN",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    ready.id,
                    inReview.id,
                  ],
                  reviewerId:
                    "reviewer-mixed",
                  reviewerDisplayName:
                    "Mixed Reviewer",
                }),
            },
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          await response.json(),
        ).toEqual({
          updated: [
            ready.id,
          ],
        });
      },
    );

    it.each([
      "REVIEWER",
      "READONLY_AUDITOR",
    ] as const)(
      "returns 403 when a %s tries to assign a reviewer",
      async role => {
        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/assign-reviewer",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(role),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    ready.id,
                  ],
                  reviewerId:
                    "reviewer-denied",
                  reviewerDisplayName:
                    "Denied Reviewer",
                }),
            },
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          (await response.json()) as
            ErrorResponse,
        ).toMatchObject({
          error: "forbidden",
        });

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 400 for an incomplete reviewer selection",
      async () => {
        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/assign-reviewer",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "ADMIN",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    ready.id,
                  ],
                  reviewerId:
                    "reviewer-incomplete",
                  reviewerDisplayName:
                    null,
                }),
            },
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "allows a clinician to regenerate failed notes and reports skipped notes",
      async () => {
        const failed =
          requireSummary(
            note =>
              note.status ===
              "FAILED",
          );

        const ready =
          requireSummary(
            note =>
              note.status ===
              "READY_FOR_REVIEW",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/regenerate",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "CLINICIAN",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    failed.id,
                    ready.id,
                  ],
                }),
            },
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          await response.json(),
        ).toEqual({
          updated: [
            failed.id,
          ],
          skipped: [
            ready.id,
          ],
        });

        expect(
          getNotes().find(
            note =>
              note.id ===
              failed.id,
          )?.status,
        ).toBe("GENERATING");
      },
    );

    it(
      "does not trust an administrator role supplied in the request body",
      async () => {
        const failed =
          requireSummary(
            note =>
              note.status ===
              "FAILED",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/regenerate",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "REVIEWER",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    failed.id,
                  ],
                  actorRole:
                    "ADMIN",
                }),
            },
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          getNotes().find(
            note =>
              note.id ===
              failed.id,
          )?.status,
        ).toBe("FAILED");

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 403 when actor headers are missing",
      async () => {
        const failed =
          requireSummary(
            note =>
              note.status ===
              "FAILED",
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/regenerate",
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  noteIds: [
                    failed.id,
                  ],
                }),
            },
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 503 for a simulated bulk-action network failure",
      async () => {
        const failed =
          requireSummary(
            note =>
              note.status ===
              "FAILED",
          );

        simulateNetworkMock
          .mockRejectedValueOnce(
            new SimulatedNetworkFailure(),
          );

        const response =
          await fetch(
            "http://localhost/api/notes/bulk/regenerate",
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createActor(
                    "ADMIN",
                  ),
                ),
              body:
                JSON.stringify({
                  noteIds: [
                    failed.id,
                  ],
                }),
            },
          );

        expect(
          response.status,
        ).toBe(503);

        expect(
          (await response.json()) as
            ErrorResponse,
        ).toMatchObject({
          error:
            "internal_error",
        });
      },
    );
  },
);
