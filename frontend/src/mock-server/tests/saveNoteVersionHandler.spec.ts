import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, } from "vitest";
import { setupServer } from "msw/node";

import type { SaveNoteVersionConflictResponse, SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../domain/noteSave";

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
import { devFailureControls, } from "../devFailureControls";
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

function createSaveRequestBody(
  noteId: string,
  clientMutationId: string,
  value: string,
): SaveNoteVersionRequestBody {
  const detail = getNoteDetail(noteId);

  if (!detail) {
    throw new Error(
      "Expected note detail.",
    );
  }

  return {
    baseVersionId:
      detail.currentVersion.versionId,

    clientMutationId,

    content: {
      subjective:
        `${value} subjective`,
      objective:
        `${value} objective`,
      assessment:
        `${value} assessment`,
      plan:
        `${value} plan`,
    },
  };
}

function postSave(
  noteId: string,
  body: SaveNoteVersionRequestBody,
): Promise<Response> {
  return fetch(
    `http://localhost/api/notes/${noteId}/versions`,
    {
      method: "POST",
      headers: getActorHeaders(),
      body: JSON.stringify(body),
    },
  );
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
        ).not.toHaveBeenCalled();
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
      "returns the server head and common ancestor when the base version is stale",
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

        const originalVersion =
          originalDetail.currentVersion;

        const concurrentSaveResponse =
          await postSave(noteId, {
            baseVersionId:
              originalVersion.versionId,
            clientMutationId:
              "mutation-concurrent-save-1",
            content: {
              subjective:
                "Concurrent subjective",
              objective:
                "Concurrent objective",
              assessment:
                "Concurrent assessment",
              plan:
                "Concurrent plan",
            },
          });

        expect(
          concurrentSaveResponse.status,
        ).toBe(201);

        const detailAfterConcurrentSave =
          getNoteDetail(noteId);

        if (!detailAfterConcurrentSave) {
          throw new Error(
            "Expected updated note detail.",
          );
        }

        const response = await postSave(
          noteId,
          {
            baseVersionId:
              originalVersion.versionId,
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
          },
        );

        expect(response.status).toBe(409);

        const body =
          (await response.json()) as
            SaveNoteVersionConflictResponse;

        expect(body.error).toBe(
          "version_conflict",
        );

        expect(body.currentVersion).toEqual(
          detailAfterConcurrentSave.currentVersion,
        );

        expect(body.commonAncestor).toEqual(
          originalVersion,
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

        const response = await postSave(
          noteId,
          createSaveRequestBody(
            noteId,
            "mutation-network-failure-1",
            "Network failure",
          ),
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

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "fails only the next valid save when the development failure is armed",
      async () => {
        const noteId =
          requireFirstNoteId();

        devFailureControls
          .armFailNextSave();

        const failedResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-dev-failure-1",
              "Failed save",
            ),
          );

        expect(
          failedResponse.status,
        ).toBe(503);

        const failedBody =
          (await failedResponse.json()) as
            ErrorResponse;

        expect(failedBody).toEqual({
          error: "internal_error",
          message:
            "Development control: the next save was intentionally failed.",
        });

        expect(
          devFailureControls
            .getSnapshot()
            .failNextSave,
        ).toBe(false);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();

        const followingResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-after-dev-failure-1",
              "Following save",
            ),
          );

        expect(
          followingResponse.status,
        ).toBe(201);

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "causes a version conflict only for the next valid save",
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

        devFailureControls
          .armConflictNextSave();

        const conflictResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-dev-conflict-1",
              "Conflict save",
            ),
          );

        expect(
          conflictResponse.status,
        ).toBe(409);

        const conflictBody =
          (await conflictResponse.json()) as
            SaveNoteVersionConflictResponse;

        expect(
          conflictBody.error,
        ).toBe("version_conflict");

        expect(
          conflictBody.currentVersion,
        ).toEqual(
          originalDetail.currentVersion,
        );

        expect(
          devFailureControls
            .getSnapshot()
            .conflictNextSave,
        ).toBe(false);

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();

        const followingResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-after-dev-conflict-1",
              "Following save",
            ),
          );

        expect(
          followingResponse.status,
        ).toBe(201);

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          conflictBody.commonAncestor,
        ).toBeNull();
      },
    );

    it(
      "delays only the next valid save",
      async () => {
        const noteId =
          requireFirstNoteId();

        const delayMs = 40;

        devFailureControls
          .armDelayNextSave(delayMs);

        const startedAt = Date.now();

        const delayedResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-dev-delay-1",
              "Delayed save",
            ),
          );

        const elapsedMs =
          Date.now() - startedAt;

        expect(
          delayedResponse.status,
        ).toBe(201);

        expect(elapsedMs).toBeGreaterThanOrEqual(
          30,
        );

        expect(
          devFailureControls
            .getSnapshot()
            .delayNextSaveMs,
        ).toBeNull();

        expect(
          simulateNetworkMock,
        ).not.toHaveBeenCalled();

        const followingResponse =
          await postSave(
            noteId,
            createSaveRequestBody(
              noteId,
              "mutation-after-dev-delay-1",
              "Following save",
            ),
          );

        expect(
          followingResponse.status,
        ).toBe(201);

        expect(
          simulateNetworkMock,
        ).toHaveBeenCalledTimes(1);
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