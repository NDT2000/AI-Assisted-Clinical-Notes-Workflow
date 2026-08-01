import { describe, expect, it } from "vitest";
import type { Note, NoteVersion, } from "../../../../domain/noteAttributes";
import type { Actor } from "../../../../domain/noteGuards";
import { deriveAvailableNoteActions } from "../note-detail/noteActionBarModel";

const NOW = "2026-07-31T20:00:00.000Z";

function createNote(
  overrides: Partial<Note> = {},
): Note {
  return {
    id: "note-1",
    patientId: "patient-1",
    sessionId: "session-1",
    status: "IN_REVIEW",
    currentVersionId: "version-1",
    assignedReviewerId: "reviewer-1",
    createdAt: "2026-07-31T18:00:00.000Z",
    updatedAt: "2026-07-31T19:00:00.000Z",
    ...overrides,
  };
}

function createVersion(
  overrides: Partial<NoteVersion> = {},
): NoteVersion {
  return {
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
    authorId: "reviewer-1",
    authorRole: "REVIEWER",
    createdAt: "2026-07-31T19:00:00.000Z",
    ...overrides,
  };
}

function createActor(
  overrides: Partial<Actor> = {},
): Actor {
  return {
    id: "reviewer-1",
    role: "REVIEWER",
    mfaVerified: false,
    ...overrides,
  };
}

describe("deriveAvailableNoteActions", () => {
  it("derives IN_REVIEW actions and preserves guard reasons", () => {
    const actions = deriveAvailableNoteActions({
      note: createNote(),
      version: createVersion(),
      actor: createActor(),
      now: NOW,
    });

    expect(
      actions.map((action) => action.trigger),
    ).toEqual([
      "RETURN_TO_QUEUE",
      "APPROVE",
      "REJECT",
    ]);

    expect(
      actions.find(
        (action) =>
          action.trigger === "RETURN_TO_QUEUE",
      ),
    ).toMatchObject({
      enabled: true,
      executionState: "IDLE",
    });

    expect(
      actions.find(
        (action) => action.trigger === "APPROVE",
      ),
    ).toMatchObject({
      enabled: false,
      disabledReason:
        "MFA re-authentication is required to approve this Note.",
    });

    expect(
      actions.find(
        (action) => action.trigger === "REJECT",
      ),
    ).toMatchObject({
      enabled: false,
      requiresReason: true,
      disabledReason:
        "A rejection reason is required.",
    });
  });

  it("enables approve and reject when their guards pass", () => {
    const actions = deriveAvailableNoteActions({
      note: createNote(),
      version: createVersion(),
      actor: createActor({
        mfaVerified: true,
      }),
      rejectionReason:
        "The assessment needs correction.",
      now: NOW,
    });

    expect(
      actions.find(
        (action) => action.trigger === "APPROVE",
      )?.enabled,
    ).toBe(true);

    expect(
      actions.find(
        (action) => action.trigger === "REJECT",
      )?.enabled,
    ).toBe(true);
  });

  it("allows workspace state to block otherwise valid actions", () => {
    const actions = deriveAvailableNoteActions({
      note: createNote({
        status: "READY_FOR_REVIEW",
      }),
      version: createVersion(),
      actor: createActor(),
      now: NOW,
      workspaceBlockReason:
        "Save the current changes before running an action.",
    });

    expect(actions).toEqual([
      {
        trigger: "START_REVIEW",
        label: "Start Review",
        enabled: false,
        requiresReason: false,
        executionState: "IDLE",
        disabledReason:
          "Save the current changes before running an action.",
      },
    ]);
  });
});