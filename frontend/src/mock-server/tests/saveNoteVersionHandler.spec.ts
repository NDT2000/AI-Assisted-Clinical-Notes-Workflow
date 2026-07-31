import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, } from "vitest";
import { setupServer } from "msw/node";

import type { SaveNoteVersionConflictResponse, SaveNoteVersionResponse, } from "../../domain/noteSave";

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

import { SimulatedNetworkFailure, simulateNetwork, } from "../mockNetwork";
import { getNoteDetail, getNotes, seedNotes, } from "../noteStore";
import { saveNoteVersionHandler, } from "../saveNoteVersionHandler";

const server = setupServer(
  saveNoteVersionHandler,
);

const simulateNetworkMock =
  vi.mocked(simulateNetwork);

interface ErrorResponse {
  error: string;
  message: string;
}

function getActorHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "x-actor-id": "reviewer-test",
    "x-actor-role": "REVIEWER",
    "x-actor-display-name":
      "Test Reviewer",
  };
}

function requireFirstNoteId(): string {
  const summary = getNotes()[0];

  if (!summary) {
    throw new Error(
      "Expected the seeded dataset to contain a note.",
    );
  }

  return summary.id;
}

describe(
  "saveNoteVersionHandler",
  () => {
    beforeAll(() => {
      server.listen({
        onUnhandledRequest: "error",
      });
    });

    beforeEach(() => {
      seedNotes(100, 42);

      simulateNetworkMock.mockReset();
      simulateNetworkMock.mockResolvedValue(
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
      "creates and returns a new note version",
      async () => {
        const noteId =
          requireFirstNoteId();

        const originalDetail =
          getNoteDetail(noteId);

        if (!originalDetail) {
          throw new Error(
            "Expected note detail.",
          );
        }

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify({
              baseVersionId:
                originalDetail
                  .currentVersion
                  .versionId,
              clientMutationId:
                "mutation-save-1",
              content: {
                subjective:
                  "Updated subjective",
                objective:
                  "Updated objective",
                assessment:
                  "Updated assessment",
                plan: "Updated plan",
              },
            }),
          },
        );

        expect(response.status).toBe(
          201,
        );

        const body =
          (await response.json()) as
            SaveNoteVersionResponse;

        expect(
          body.clientMutationId,
        ).toBe("mutation-save-1");

        expect(
          body.savedVersion
            .revisionNumber,
        ).toBe(
          originalDetail
            .currentVersion
            .revisionNumber + 1,
        );

        expect(
          body.savedVersion
            .parentVersionId,
        ).toBe(
          originalDetail
            .currentVersion
            .versionId,
        );

        expect(
          body.savedVersion.content,
        ).toEqual({
          subjective:
            "Updated subjective",
          objective:
            "Updated objective",
          assessment:
            "Updated assessment",
          plan: "Updated plan",
        });

        const updatedDetail =
          getNoteDetail(noteId);

        expect(
          updatedDetail?.currentVersion
            .versionId,
        ).toBe(
          body.savedVersion.versionId,
        );
      },
    );

    it(
      "returns 400 for an invalid body",
      async () => {
        const noteId =
          requireFirstNoteId();

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify({
              baseVersionId: "",
            }),
          },
        );

        expect(response.status).toBe(
          400,
        );

        const body =
          (await response.json()) as
            ErrorResponse;

        expect(body.error).toBe(
          "invalid_request",
        );

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns 403 when actor headers are missing",
      async () => {
        const noteId =
          requireFirstNoteId();

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({}),
          },
        );

        expect(response.status).toBe(
          403,
        );

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 403 for a read-only auditor",
      async () => {
        const noteId =
          requireFirstNoteId();

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: {
              ...getActorHeaders(),
              "x-actor-role":
                "READONLY_AUDITOR",
            },
            body: JSON.stringify({}),
          },
        );

        expect(response.status).toBe(
          403,
        );

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns 404 for an unknown note",
      async () => {
        const response = await fetch(
          "http://localhost/api/notes/note-does-not-exist/versions",
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify({
              baseVersionId:
                "version-1",
              clientMutationId:
                "mutation-missing-1",
              content: {
                subjective: "",
                objective: "",
                assessment: "",
                plan: "",
              },
            }),
          },
        );

        expect(response.status).toBe(
          404,
        );

        const body =
          (await response.json()) as
            ErrorResponse;

        expect(body.error).toBe(
          "not_found",
        );
      },
    );

    it(
      "returns 409 when the base version is stale",
      async () => {
        const noteId =
          requireFirstNoteId();

        const currentDetail =
          getNoteDetail(noteId);

        if (!currentDetail) {
          throw new Error(
            "Expected note detail.",
          );
        }

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify({
              baseVersionId:
                "stale-version-id",
              clientMutationId:
                "mutation-conflict-1",
              content: {
                subjective:
                  "Conflicting subjective",
                objective:
                  "Conflicting objective",
                assessment:
                  "Conflicting assessment",
                plan:
                  "Conflicting plan",
              },
            }),
          },
        );

        expect(response.status).toBe(
          409,
        );

        const body =
          (await response.json()) as
            SaveNoteVersionConflictResponse;

        expect(body.error).toBe(
          "version_conflict",
        );

        expect(
          body.currentVersion,
        ).toEqual(
          currentDetail.currentVersion,
        );
      },
    );

    it(
      "returns 503 after a simulated network failure",
      async () => {
        simulateNetworkMock
          .mockRejectedValueOnce(
            new SimulatedNetworkFailure(),
          );

        const noteId =
          requireFirstNoteId();

        const response = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify({}),
          },
        );

        expect(response.status).toBe(
          503,
        );

        const body =
          (await response.json()) as
            ErrorResponse;

        expect(body).toEqual({
          error: "internal_error",
          message:
            "Simulated network failure.",
        });
      },
    );

    it(
      "returns the original saved response when the same mutation is retried",
      async () => {
        const noteId = requireFirstNoteId();

        const originalDetail =
          getNoteDetail(noteId);

        if (!originalDetail) {
          throw new Error(
            "Expected note detail.",
          );
        }

        const originalVersionCount =
          originalDetail.versions.length;

        const requestBody = {
          baseVersionId:
            originalDetail.currentVersion
              .versionId,
          clientMutationId:
            "mutation-http-retry-1",
          content: {
            subjective:
              "Updated subjective",
            objective:
              "Updated objective",
            assessment:
              "Updated assessment",
            plan: "Updated plan",
          },
        };

        const firstResponse = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify(requestBody),
          },
        );

        expect(firstResponse.status).toBe(
          201,
        );

        const firstBody =
          (await firstResponse.json()) as
            SaveNoteVersionResponse;

        const retryResponse = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify(requestBody),
          },
        );

        expect(retryResponse.status).toBe(
          201,
        );

        const retryBody =
          (await retryResponse.json()) as
            SaveNoteVersionResponse;

        expect(retryBody).toEqual(firstBody);

        const detailAfterRetry =
          getNoteDetail(noteId);

        expect(
          detailAfterRetry?.versions,
        ).toHaveLength(
          originalVersionCount + 1,
        );

        expect(
          detailAfterRetry?.currentVersion
            .versionId,
        ).toBe(
          firstBody.savedVersion.versionId,
        );
      },
    );

    it(
      "returns 409 when a mutation ID is reused for different content",
      async () => {
        const noteId = requireFirstNoteId();

        const originalDetail =
          getNoteDetail(noteId);

        if (!originalDetail) {
          throw new Error(
            "Expected note detail.",
          );
        }

        const originalVersionCount =
          originalDetail.versions.length;

        const firstRequestBody = {
          baseVersionId:
            originalDetail.currentVersion
              .versionId,
          clientMutationId:
            "mutation-http-reused-1",
          content: {
            subjective:
              "First subjective",
            objective:
              "First objective",
            assessment:
              "First assessment",
            plan: "First plan",
          },
        };

        const firstResponse = await fetch(
          `http://localhost/api/notes/${noteId}/versions`,
          {
            method: "POST",
            headers: getActorHeaders(),
            body: JSON.stringify(
              firstRequestBody,
            ),
          },
        );

        expect(firstResponse.status).toBe(
          201,
        );

        const conflictingResponse =
          await fetch(
            `http://localhost/api/notes/${noteId}/versions`,
            {
              method: "POST",
              headers: getActorHeaders(),
              body: JSON.stringify({
                ...firstRequestBody,
                content: {
                  ...firstRequestBody.content,
                  subjective:
                    "Different subjective",
                },
              }),
            },
          );

        expect(
          conflictingResponse.status,
        ).toBe(409);

        const conflictBody =
          (await conflictingResponse.json()) as
            ErrorResponse;

        expect(conflictBody.error).toBe(
          "idempotency_conflict",
        );

        const detailAfterConflict =
          getNoteDetail(noteId);

        expect(
          detailAfterConflict?.versions,
        ).toHaveLength(
          originalVersionCount + 1,
        );
      },
    );
  },
);