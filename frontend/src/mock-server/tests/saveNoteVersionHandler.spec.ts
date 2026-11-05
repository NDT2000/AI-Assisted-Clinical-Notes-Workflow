import { mockAuthHeaders } from "../mockAuth";
import type {
  Actor,
} from "../../domain/actor";
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
  NoteDetail,
} from "../../domain/noteDetail";
import type {
  NoteSummary,
} from "../../domain/noteSummary";
import type {
  SaveNoteVersionRequestBody,
  SaveNoteVersionResponse,
} from "../../domain/noteSave";

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
  devFailureControls,
} from "../devFailureControls";
import {
  getNoteDetail,
  getNotes,
  reassignNotes,
  seedNotes,
  transitionNote,
} from "../noteStore";
import {
  saveNoteVersionHandler,
} from "../saveNoteVersionHandler";
import {
  mockRealtimeChannel,
} from "../../features/notes/realtime/mockRealtimeChannel";

const server =
  setupServer(
    saveNoteVersionHandler,
  );

const simulateNetworkMock =
  vi.mocked(
    simulateNetwork,
  );

interface ErrorResponse {
  error: string;
  message: string;
}

function getActorHeaders(
  actor:
    Actor,
): HeadersInit {
  return {
    "content-type":
      "application/json",
    ...mockAuthHeaders(actor),
  };
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

function requireDetail(
  noteId: string,
): NoteDetail {
  const detail =
    getNoteDetail(noteId);

  if (!detail) {
    throw new Error(
      `Expected note detail for ${noteId}.`,
    );
  }

  return detail;
}

function createReviewer(
  id = "reviewer-handler-1",
): Actor {
  return {
    id,
    displayName:
      `Reviewer ${id}`,
    role: "REVIEWER",
    mfaVerified: true,
  };
}

function prepareInReviewNote(
  reviewer:
    Actor =
      createReviewer(),
): NoteDetail {
  const ready =
    requireSummary(
      note =>
        note.status ===
        "READY_FOR_REVIEW",
    );

  reassignNotes(
    [ready.id],
    null,
    "ADMIN",
  );

  const detail =
    requireDetail(ready.id);

  const transitionResult =
    transitionNote(
      ready.id,
      {
        baseVersionId:
          detail.currentVersion
            .versionId,
        clientMutationId:
          `start-${reviewer.id}`,
        trigger:
          "START_REVIEW",
      },
      reviewer,
      "2026-08-02T13:00:00.000Z",
    );

  if (
    transitionResult.outcome !==
    "transitioned"
  ) {
    throw new Error(
      "Expected the note to enter review.",
    );
  }

  return requireDetail(
    ready.id,
  );
}

function createSaveBody(
  detail: NoteDetail,
  clientMutationId: string,
): SaveNoteVersionRequestBody {
  return {
    baseVersionId:
      detail.currentVersion
        .versionId,
    clientMutationId,
    content: {
      subjective:
        "Updated subjective.",
      objective:
        "Updated objective.",
      assessment:
        "Updated assessment.",
      plan:
        "Updated plan.",
    },
  };
}

function postSave(
  noteId: string,
  body:
    SaveNoteVersionRequestBody,
  actor:
    Actor,
): Promise<Response> {
  return fetch(
    `http://localhost/api/notes/${noteId}/versions`,
    {
      method: "POST",
      headers:
        getActorHeaders(actor),
      body:
        JSON.stringify(body),
    },
  );
}

describe(
  "saveNoteVersionHandler",
  () => {
    beforeAll(() => {
      server.listen({
        onUnhandledRequest:
          "error",
      });
    });

    beforeEach(() => {
      seedNotes(500, 42);
      devFailureControls.reset();

      simulateNetworkMock
        .mockReset();

      simulateNetworkMock
        .mockResolvedValue(
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
      "creates a version for the assigned reviewer",
      async () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareInReviewNote(
            reviewer,
          );

        const response =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-handler-1",
            ),
            reviewer,
          );

        expect(
          response.status,
        ).toBe(201);

        const body =
          (await response.json()) as
            SaveNoteVersionResponse;

        expect(
          body.savedVersion
            .revisionNumber,
        ).toBe(
          detail.currentVersion
            .revisionNumber + 1,
        );

        expect(
          body.savedVersion
            .authorId,
        ).toBe(reviewer.id);
      },
    );

    it(
      "broadcasts a saved version to real-time subscribers, but not a rejected save",
      async () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareInReviewNote(
            reviewer,
          );

        mockRealtimeChannel.reset();

        const events: string[] = [];

        const connection =
          mockRealtimeChannel.connect({
            noteIds: [detail.note.id],
            afterCursor: 0,
            onEvent: event => {
              events.push(event.type);
            },
            onDisconnect: vi.fn(),
          });

        const rejected =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-handler-broadcast-rejected",
            ),
            createReviewer(
              "reviewer-not-assigned",
            ),
          );

        expect(rejected.status).toBe(403);
        expect(events).toEqual([]);

        const saved =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-handler-broadcast",
            ),
            reviewer,
          );

        expect(saved.status).toBe(201);
        expect(events).toEqual([
          "note.version_added",
        ]);

        connection.disconnect();
        mockRealtimeChannel.reset();
      },
    );

    it(
      "returns 403 for a reviewer who does not own the note",
      async () => {
        const owner =
          createReviewer(
            "reviewer-owner",
          );

        const detail =
          prepareInReviewNote(
            owner,
          );

        const response =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-handler-other",
            ),
            createReviewer(
              "reviewer-other",
            ),
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          (await response.json()) as
            ErrorResponse,
        ).toEqual({
          error: "forbidden",
          message:
            "Only the assigned reviewer can edit this note.",
        });
      },
    );

    it(
      "returns 403 for a read-only auditor before sending the request to the store",
      async () => {
        const detail =
          prepareInReviewNote();

        const response =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-handler-auditor",
            ),
            {
              id: "auditor-1",
              displayName:
                "Read-only Auditor",
              role:
                "READONLY_AUDITOR",
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
      "allows a clinician to save corrected rejected content",
      async () => {
        const reviewer =
          createReviewer();

        const inReview =
          prepareInReviewNote(
            reviewer,
          );

        const rejected =
          transitionNote(
            inReview.note.id,
            {
              baseVersionId:
                inReview
                  .currentVersion
                  .versionId,
              clientMutationId:
                "reject-handler-1",
              trigger: "REJECT",
              rejectionReason:
                "The assessment requires clarification.",
            },
            reviewer,
            "2026-08-02T13:05:00.000Z",
          );

        expect(
          rejected.outcome,
        ).toBe("transitioned");

        const rejectedDetail =
          requireDetail(
            inReview.note.id,
          );

        const response =
          await postSave(
            rejectedDetail.note.id,
            createSaveBody(
              rejectedDetail,
              "save-rejected-handler-1",
            ),
            {
              id: "clinician-1",
              displayName:
                "Current Clinician",
              role: "CLINICIAN",
            },
          );

        expect(
          response.status,
        ).toBe(201);
      },
    );

    it(
      "returns 400 for an invalid request body",
      async () => {
        const detail =
          prepareInReviewNote();

        const response =
          await fetch(
            `http://localhost/api/notes/${detail.note.id}/versions`,
            {
              method: "POST",
              headers:
                getActorHeaders(
                  createReviewer(),
                ),
              body:
                JSON.stringify({
                  baseVersionId: "",
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
      "returns 403 without an access token",
      async () => {
        const detail =
          prepareInReviewNote();

        const response =
          await fetch(
            `http://localhost/api/notes/${detail.note.id}/versions`,
            {
              method: "POST",
              headers: {
                "content-type":
                  "application/json",
              },
              body:
                JSON.stringify(
                  createSaveBody(
                    detail,
                    "save-no-actor",
                  ),
                ),
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
      "returns 404 for an unknown note",
      async () => {
        const response =
          await postSave(
            "note-does-not-exist",
            {
              baseVersionId:
                "version-1",
              clientMutationId:
                "save-missing-note",
              content: {
                subjective:
                  "Subjective",
                objective:
                  "Objective",
                assessment:
                  "Assessment",
                plan: "Plan",
              },
            },
            createReviewer(),
          );

        expect(
          response.status,
        ).toBe(404);

        expect(
          (await response.json()) as
            ErrorResponse,
        ).toMatchObject({
          error: "not_found",
        });
      },
    );

    it(
      "returns 409 with the server head for an authorized stale save",
      async () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareInReviewNote(
            reviewer,
          );

        const response =
          await postSave(
            detail.note.id,
            {
              ...createSaveBody(
                detail,
                "save-stale-handler",
              ),
              baseVersionId:
                "stale-version-id",
            },
            reviewer,
          );

        expect(
          response.status,
        ).toBe(409);

        expect(
          (await response.json()) as
            ErrorResponse,
        ).toMatchObject({
          error:
            "version_conflict",
        });
      },
    );

    it(
      "returns the same response for an idempotent retry",
      async () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareInReviewNote(
            reviewer,
          );

        const body =
          createSaveBody(
            detail,
            "save-idempotent-handler",
          );

        const first =
          await postSave(
            detail.note.id,
            body,
            reviewer,
          );

        const second =
          await postSave(
            detail.note.id,
            body,
            reviewer,
          );

        expect(
          first.status,
        ).toBe(201);

        expect(
          second.status,
        ).toBe(201);

        expect(
          await second.json(),
        ).toEqual(
          await first.json(),
        );
      },
    );

    it(
      "returns 503 for a simulated network failure",
      async () => {
        const reviewer =
          createReviewer();

        const detail =
          prepareInReviewNote(
            reviewer,
          );

        simulateNetworkMock
          .mockRejectedValueOnce(
            new SimulatedNetworkFailure(),
          );

        const response =
          await postSave(
            detail.note.id,
            createSaveBody(
              detail,
              "save-network-failure",
            ),
            reviewer,
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
