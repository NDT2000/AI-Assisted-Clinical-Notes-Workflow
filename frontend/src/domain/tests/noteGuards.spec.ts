import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  Note,
  NoteStatus,
  NoteVersion,
  UserRole,
} from "../noteAttributes";
import {
  canAssignReviewer,
  canEditNoteContent,
  canManageReviewerAssignments,
  canRequestRegeneration,
  canTransition,
} from "../noteGuards";

const baseNote: Note = {
  id: "note-1",
  patientId: "patient-1",
  sessionId: "session-1",
  status: "READY_FOR_REVIEW",
  currentVersionId: "version-1",
  assignedReviewerId: null,
  createdAt:
    "2026-08-02T10:00:00.000Z",
  updatedAt:
    "2026-08-02T10:00:00.000Z",
};

const baseVersion: NoteVersion = {
  versionId: "version-1",
  noteId: "note-1",
  revisionNumber: 1,
  parentVersionId: null,
  content: {
    subjective:
      "Patient reports improvement.",
    objective:
      "Patient appeared calm.",
    assessment:
      "Symptoms are improving.",
    plan:
      "Continue the current treatment plan.",
  },
  authorId: "clinician-1",
  authorRole: "CLINICIAN",
  createdAt:
    "2026-08-02T10:00:00.000Z",
};

function createNote(
  status: NoteStatus,
  assignedReviewerId:
    | string
    | null = null,
): Note {
  return {
    ...baseNote,
    status,
    assignedReviewerId,
  };
}

describe(
  "reviewer assignment authorization",
  () => {
    it.each<
      [UserRole]
    >([
      ["CLINICIAN"],
      ["ADMIN"],
    ])(
      "allows %s actors to manage reviewer assignments",
      role => {
        expect(
          canManageReviewerAssignments(
            role,
          ),
        ).toEqual({
          allowed: true,
        });
      },
    );

    it.each<
      [UserRole]
    >([
      ["REVIEWER"],
      ["READONLY_AUDITOR"],
    ])(
      "denies %s actors from managing reviewer assignments",
      role => {
        expect(
          canManageReviewerAssignments(
            role,
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Only a Clinician or an Administrator can assign reviewers.",
        });
      },
    );

    it.each<
      [NoteStatus]
    >([
      ["READY_FOR_REVIEW"],
      ["AMENDED"],
    ])(
      "allows assignment for %s notes",
      status => {
        expect(
          canAssignReviewer(
            status,
            "ADMIN",
          ),
        ).toEqual({
          allowed: true,
        });
      },
    );

    it.each<
      [NoteStatus]
    >([
      ["GENERATING"],
      ["FAILED"],
      ["IN_REVIEW"],
      ["REJECTED"],
      ["APPROVED"],
      ["LOCKED"],
    ])(
      "denies assignment for %s notes",
      status => {
        expect(
          canAssignReviewer(
            status,
            "ADMIN",
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Reviewer assignment is available only for notes that are ready for review or amended.",
        });
      },
    );
  },
);

describe(
  "note content editing authorization",
  () => {
    it(
      "allows the assigned reviewer to edit an in-review note",
      () => {
        expect(
          canEditNoteContent(
            createNote(
              "IN_REVIEW",
              "reviewer-1",
            ),
            {
              id: "reviewer-1",
              role: "REVIEWER",
            },
          ),
        ).toEqual({
          allowed: true,
        });
      },
    );

    it(
      "denies a different reviewer from editing an in-review note",
      () => {
        expect(
          canEditNoteContent(
            createNote(
              "IN_REVIEW",
              "reviewer-1",
            ),
            {
              id: "reviewer-2",
              role: "REVIEWER",
            },
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Only the assigned reviewer can edit this note.",
        });
      },
    );

    it.each<
      [NoteStatus]
    >([
      ["REJECTED"],
      ["AMENDED"],
    ])(
      "allows a clinician to edit a %s note",
      status => {
        expect(
          canEditNoteContent(
            createNote(status),
            {
              id: "clinician-1",
              role: "CLINICIAN",
            },
          ),
        ).toEqual({
          allowed: true,
        });
      },
    );

    it(
      "denies a clinician from editing an in-review note",
      () => {
        expect(
          canEditNoteContent(
            createNote(
              "IN_REVIEW",
              "reviewer-1",
            ),
            {
              id: "clinician-1",
              role: "CLINICIAN",
            },
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Clinicians can edit rejected or amended notes.",
        });
      },
    );

    it.each<
      [NoteStatus]
    >([
      ["IN_REVIEW"],
      ["REJECTED"],
      ["AMENDED"],
    ])(
      "allows an administrator to edit a %s note",
      status => {
        expect(
          canEditNoteContent(
            createNote(status),
            {
              id: "admin-1",
              role: "ADMIN",
            },
          ),
        ).toEqual({
          allowed: true,
        });
      },
    );

    it(
      "always denies a read-only auditor",
      () => {
        expect(
          canEditNoteContent(
            createNote(
              "IN_REVIEW",
              "reviewer-1",
            ),
            {
              id: "auditor-1",
              role:
                "READONLY_AUDITOR",
            },
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Read-only auditors cannot edit note content.",
        });
      },
    );

    it(
      "keeps locked notes read-only for an administrator",
      () => {
        expect(
          canEditNoteContent(
            createNote("LOCKED"),
            {
              id: "admin-1",
              role: "ADMIN",
            },
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Locked notes are read-only.",
        });
      },
    );
  },
);

describe(
  "transition authorization",
  () => {
    it(
      "allows a reviewer to start an unassigned note",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "READY_FOR_REVIEW",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
            },
            action:
              "START_REVIEW",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus:
            "IN_REVIEW",
        });
      },
    );

    it(
      "allows the assigned reviewer to restart an amended note",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "AMENDED",
                "reviewer-1",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
            },
            action:
              "START_REVIEW",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus:
            "IN_REVIEW",
        });
      },
    );

    it(
      "denies a reviewer when the note is assigned to somebody else",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "READY_FOR_REVIEW",
                "reviewer-2",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
            },
            action:
              "START_REVIEW",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: false,
          reason:
            "This note is assigned to another reviewer.",
        });
      },
    );

    it(
      "allows approval only for the assigned reviewer with MFA",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "IN_REVIEW",
                "reviewer-1",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
              mfaVerified: true,
            },
            action: "APPROVE",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus: "APPROVED",
        });
      },
    );

    it(
      "denies approval without MFA",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "IN_REVIEW",
                "reviewer-1",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
              mfaVerified: false,
            },
            action: "APPROVE",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: false,
          reason:
            "MFA re-authentication is required to approve this note.",
        });
      },
    );

    it(
      "requires the assigned reviewer and a reason for rejection",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "IN_REVIEW",
                "reviewer-1",
              ),
            version: baseVersion,
            actor: {
              id: "reviewer-1",
              role: "REVIEWER",
            },
            action: "REJECT",
            rejectionReason:
              "The assessment needs more detail.",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus: "REJECTED",
        });
      },
    );

    it(
      "allows a clinician to resubmit complete rejected content",
      () => {
        expect(
          canTransition({
            note:
              createNote(
                "REJECTED",
                "reviewer-1",
              ),
            version: baseVersion,
            actor: {
              id: "clinician-1",
              role: "CLINICIAN",
            },
            action: "RESUBMIT",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus:
            "READY_FOR_REVIEW",
        });
      },
    );

    it(
      "allows amendment inside the 24-hour window",
      () => {
        expect(
          canTransition({
            note: {
              ...createNote(
                "APPROVED",
                "reviewer-1",
              ),
              approvedAt:
                "2026-08-02T10:00:00.000Z",
            },
            version: baseVersion,
            actor: {
              id: "clinician-1",
              role: "CLINICIAN",
            },
            action: "AMEND",
            now:
              "2026-08-03T09:59:59.000Z",
          }),
        ).toEqual({
          allowed: true,
          nextStatus: "AMENDED",
        });
      },
    );

    it(
      "blocks every transition from a locked note",
      () => {
        expect(
          canTransition({
            note:
              createNote("LOCKED"),
            version: baseVersion,
            actor: {
              id: "admin-1",
              role: "ADMIN",
            },
            action: "AMEND",
            now:
              "2026-08-02T11:00:00.000Z",
          }),
        ).toEqual({
          allowed: false,
          reason:
            "Locked notes cannot be transitioned.",
        });
      },
    );

    it.each<
      [UserRole]
    >([
      ["REVIEWER"],
      ["READONLY_AUDITOR"],
    ])(
      "denies regeneration for %s actors",
      role => {
        expect(
          canRequestRegeneration(
            "FAILED",
            role,
          ),
        ).toEqual({
          allowed: false,
          reason:
            "Only a Clinician or an Administrator can regenerate a note.",
        });
      },
    );
  },
);
