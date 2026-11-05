import { createMockToken, mockAuthHeaders } from "../mockAuth";
import type { UserRole } from "../../domain/noteAttributes";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, } from "vitest";
import { setupServer } from "msw/node";

import type { NoteDetail } from "../../domain/noteDetail";

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
import { getNoteDetailHandler } from "../getNoteDetailHandler";
import { getNotes, seedNotes, } from "../noteStore";

const server = setupServer(
  getNoteDetailHandler,
);

const simulateNetworkMock =
  vi.mocked(simulateNetwork);

interface ErrorResponse {
  error: string;
  message: string;
}


const TEST_REVIEWER = {
  id: "reviewer-1",
  displayName: "Alex Kim",
  role: "REVIEWER" as const,
};

describe("getNoteDetailHandler", () => {
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

  it("returns note detail for an authorized actor", async () => {
    const summary = getNotes()[0];

    if (!summary) {
      throw new Error(
        "Expected the seeded dataset to contain a note.",
      );
    }

    const response = await fetch(
      `http://localhost/api/notes/${summary.id}`,
      {
        headers: {
          ...mockAuthHeaders(TEST_REVIEWER),
        },
      },
    );

    expect(response.status).toBe(200);

    const detail =
      (await response.json()) as NoteDetail;

    expect(detail.note.id).toBe(
      summary.id,
    );

    expect(detail.note.status).toBe(
      summary.status,
    );

    expect(detail.patient.id).toBe(
      summary.patient.id,
    );

    expect(
      detail.patient.displayName,
    ).toBe(summary.patient.displayName);

    expect(
      detail.currentVersion.versionId,
    ).toBe(summary.currentVersion.id);

    expect(
      detail.currentVersion.revisionNumber,
    ).toBe(
      summary.currentVersion.revision,
    );

    expect(detail.versions.length).toBe(
      summary.currentVersion.revision,
    );
  });

  it("returns 403 when the actor role is missing", async () => {
    const summary = getNotes()[0];

    if (!summary) {
      throw new Error(
        "Expected the seeded dataset to contain a note.",
      );
    }

    const response = await fetch(
      `http://localhost/api/notes/${summary.id}`,
    );

    expect(response.status).toBe(403);

    const body =
      (await response.json()) as ErrorResponse;

    expect(body).toEqual({
      error: "forbidden",
      message:
        "You are not authorized to view this note.",
    });

    expect(
      simulateNetworkMock,
    ).not.toHaveBeenCalled();
  });

  it("returns 403 when the actor role is invalid", async () => {
    const summary = getNotes()[0];

    if (!summary) {
      throw new Error(
        "Expected the seeded dataset to contain a note.",
      );
    }

    const response = await fetch(
      `http://localhost/api/notes/${summary.id}`,
      {
        headers: {
          authorization: `Bearer ${createMockToken({
            ...TEST_REVIEWER,
            role: "PATIENT" as UserRole,
          })}`,
        },
      },
    );

    expect(response.status).toBe(403);

    expect(
      simulateNetworkMock,
    ).not.toHaveBeenCalled();
  });

  it("returns 404 when an authorized actor requests an unknown note", async () => {
    const response = await fetch(
      "http://localhost/api/notes/note-does-not-exist",
      {
        headers: {
          ...mockAuthHeaders(TEST_REVIEWER),
        },
      },
    );

    expect(response.status).toBe(404);

    const body =
      (await response.json()) as ErrorResponse;

    expect(body).toEqual({
      error: "not_found",
      message:
        "Note note-does-not-exist was not found.",
    });

    expect(
      simulateNetworkMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns 503 after a simulated network failure", async () => {
    simulateNetworkMock.mockRejectedValueOnce(
      new SimulatedNetworkFailure(),
    );

    const summary = getNotes()[0];

    if (!summary) {
      throw new Error(
        "Expected the seeded dataset to contain a note.",
      );
    }

    const response = await fetch(
      `http://localhost/api/notes/${summary.id}`,
      {
        headers: {
          ...mockAuthHeaders(TEST_REVIEWER),
        },
      },
    );

    expect(response.status).toBe(503);

    const body =
      (await response.json()) as ErrorResponse;

    expect(body).toEqual({
      error: "internal_error",
      message:
        "Simulated network failure.",
    });
  });
});