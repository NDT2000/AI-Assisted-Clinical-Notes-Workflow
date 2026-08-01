import { afterAll, afterEach, beforeAll, describe, expect, it, } from "vitest";
import { http, HttpResponse, } from "msw";
import { setupServer } from "msw/node";

import type { SaveNoteVersionActor, SaveNoteVersionRequestBody, SaveNoteVersionResponse, } from "../../../../domain/noteSave";
import { classifySaveNoteVersionError, saveNoteVersion, SaveNoteVersionRequestError, } from "../saveNoteVersion";

const server = setupServer();

const actor: SaveNoteVersionActor = {
  id: "reviewer-1",
  displayName: "Test Reviewer",
  role: "REVIEWER",
};

const requestBody:
  SaveNoteVersionRequestBody = {
    baseVersionId: "version-1",
    clientMutationId: "mutation-1",
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

function createSuccessResponse():
  SaveNoteVersionResponse {
  return {
    clientMutationId: "mutation-1",

    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status: "IN_REVIEW",
      currentVersionId: "version-2",
      assignedReviewerId:
        "reviewer-1",
      createdAt:
        "2026-07-31T20:00:00.000Z",
      updatedAt:
        "2026-07-31T20:30:00.000Z",
    },

    savedVersion: {
      versionId: "version-2",
      noteId: "note-1",
      revisionNumber: 2,
      parentVersionId: "version-1",
      content: {
        ...requestBody.content,
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

describe("saveNoteVersion", () => {
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "error",
    });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it("sends the save request and returns the created version", async () => {
    const successResponse =
      createSuccessResponse();

    server.use(
      http.post(
        "*/api/notes/:noteId/versions",
        async ({
          params,
          request,
        }) => {
          expect(params.noteId).toBe(
            "note-1",
          );

          expect(
            request.headers.get(
              "x-actor-id",
            ),
          ).toBe("reviewer-1");

          expect(
            request.headers.get(
              "x-actor-role",
            ),
          ).toBe("REVIEWER");

          expect(
            request.headers.get(
              "x-actor-display-name",
            ),
          ).toBe("Test Reviewer");

          expect(
            await request.json(),
          ).toEqual(requestBody);

          return HttpResponse.json(
            successResponse,
            {
              status: 201,
            },
          );
        },
      ),
    );

    const result =
      await saveNoteVersion(
        "note-1",
        actor,
        requestBody,
      );

    expect(result).toEqual(
      successResponse,
    );
  });

  it("throws a typed error for a version conflict", async () => {
    const currentVersion =
      createSuccessResponse()
        .savedVersion;

    const commonAncestor = {
      ...currentVersion,
      versionId: "version-1",
      revisionNumber: 1,
      parentVersionId: null,
    };

    server.use(
      http.post(
        "*/api/notes/:noteId/versions",
        () =>
          HttpResponse.json(
            {
              error:
                "version_conflict",
              message:
                "The note has changed.",
              currentVersion,
              commonAncestor,
            },
            {
              status: 409,
            },
          ),
      ),
    );

    let receivedError: unknown;

    try {
      await saveNoteVersion(
        "note-1",
        actor,
        requestBody,
      );
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(
      SaveNoteVersionRequestError,
    );

    expect(receivedError).toMatchObject({
      status: 409,
      code: "version_conflict",
      message:
        "The note has changed.",
      currentVersion,
      commonAncestor,
    });

    expect(
      classifySaveNoteVersionError(
        receivedError,
      ),
    ).toBe("conflict");
  });

  it("classifies ordinary request failures as save failures", async () => {
    server.use(
      http.post(
        "*/api/notes/:noteId/versions",
        () =>
          HttpResponse.json(
            {
              error: "internal_error",
              message:
                "The save failed.",
            },
            {
              status: 503,
            },
          ),
      ),
    );

    let receivedError: unknown;

    try {
      await saveNoteVersion(
        "note-1",
        actor,
        requestBody,
      );
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toMatchObject({
      status: 503,
      code: "internal_error",
      message:
        "The save failed.",
    });

    expect(
      classifySaveNoteVersionError(
        receivedError,
      ),
    ).toBe("save-failed");
  });

  it("rejects an invalid successful response", async () => {
    server.use(
      http.post(
        "*/api/notes/:noteId/versions",
        () =>
          HttpResponse.json(
            {
              unexpected: true,
            },
            {
              status: 201,
            },
          ),
      ),
    );

    await expect(
      saveNoteVersion(
        "note-1",
        actor,
        requestBody,
      ),
    ).rejects.toMatchObject({
      status: 201,
      code: "internal_error",
      message:
        "The server returned an invalid save response.",
    });
  });
});