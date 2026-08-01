import { describe, expect, it } from "vitest";
import { canTransition } from "../noteGuards";
import type { Note, NoteVersion } from "../noteAttributes";

const baseNote: Note = {
  id: "note-1",
  patientId: "patient-1",
  sessionId: "session-1",
  status: "FAILED",
  currentVersionId: "version-1",
  assignedReviewerId: null,
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
};

const baseVersion: NoteVersion = {
  versionId: "version-1",
  noteId: "note-1",
  revisionNumber: 1,
  parentVersionId: null,
  content: {
    subjective: "Patient reports improvement.",
    objective: "Patient appeared calm.",
    assessment: "Symptoms are improving.",
    plan: "Continue the current treatment plan.",
  },
  authorId: "clinician-1",
  authorRole: "CLINICIAN",
  createdAt: "2026-07-28T10:00:00.000Z",
};

describe("canTransition", () => {
  it("allows a clinician to regenerate a failed note", () => {
    const result = canTransition({
      note: baseNote,
      version: baseVersion,
      actor: {
        id: "clinician-1",
        role: "CLINICIAN",
      },
      action: "REGENERATE",
      now: "2026-07-28T11:00:00.000Z",
    });

    expect(result).toEqual({
      allowed: true,
      nextStatus: "GENERATING",
    });
  });
});

it("allows an administrator to regenerate a failed note", () => {
  const result = canTransition({
    note: baseNote,
    version: baseVersion,
    actor: {
      id: "admin-1",
      role: "ADMIN",
    },
    action: "REGENERATE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "GENERATING",
  });
});

it("does not allow a reviewer to regenerate a failed note", () => {
  const result = canTransition({
    note: baseNote,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "REGENERATE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only a Clinician or an Administrator can regenerate a note",
  });
});

it("allows a reviewer to start reviewing a ready note", () => {
  const note: Note = {
    ...baseNote,
    status: "READY_FOR_REVIEW",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "START_REVIEW",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "IN_REVIEW",
  });
});

it("does not allow a clinician to start reviewing a note", () => {
  const note: Note = {
    ...baseNote,
    status: "READY_FOR_REVIEW",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "START_REVIEW",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only a Reviewer can start a review",
  });
});

it("allows the assigned reviewer to approve a note", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
      mfaVerified: true,
    },
    action: "APPROVE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "APPROVED",
  });
});

it("does not allow approval without MFA re-authentication", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
      mfaVerified: false,
    },
    action: "APPROVE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "MFA re-authentication is required to approve this Note.",
  });
});

it("does not allow a clinician to approve a note", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "APPROVE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only a Reviewer can approve a Note.",
  });
});

it("does not allow an unassigned reviewer to approve a note", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-2",
      role: "REVIEWER",
    },
    action: "APPROVE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only an assigned Reviewer can approve this Note.",
  });
});

it("allows the assigned reviewer to reject a note with a reason", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "REJECT",
    rejectionReason: "The assessment requires more detail.",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "REJECTED",
  });
});

it("does not allow rejection without a reason", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "REJECT",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "A rejection reason is required.",
  });
});

it("does not allow rejection with an empty reason", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "REJECT",
    rejectionReason: "   ",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "A rejection reason is required.",
  });
});

it("allows a clinician to resubmit a completed rejected note", () => {
  const note: Note = {
    ...baseNote,
    status: "REJECTED",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "RESUBMIT",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "READY_FOR_REVIEW",
  });
});

it("does not allow resubmission when SOAP content is incomplete", () => {
  const note: Note = {
    ...baseNote,
    status: "REJECTED",
  };

  const incompleteVersion: NoteVersion = {
    ...baseVersion,
    content: {
      ...baseVersion.content,
      assessment: "",
    },
  };

  const result = canTransition({
    note,
    version: incompleteVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "RESUBMIT",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "All SOAP content must be completed before resubmission.",
  });
});

it("does not allow a reviewer to resubmit a rejected note", () => {
  const note: Note = {
    ...baseNote,
    status: "REJECTED",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "RESUBMIT",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only a Clinician can resubmit a Note.",
  });
});

it("allows the assigned reviewer to return a note to the queue", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "RETURN_TO_QUEUE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "READY_FOR_REVIEW",
  });
});

it("does not allow an unassigned reviewer to return a note to the queue", () => {
  const note: Note = {
    ...baseNote,
    status: "IN_REVIEW",
    assignedReviewerId: "reviewer-1",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-2",
      role: "REVIEWER",
    },
    action: "RETURN_TO_QUEUE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only the assigned reviewer can return this note.",
  });
});

it("allows a clinician to amend a note within 24 hours of approval", () => {
  const note: Note = {
    ...baseNote,
    status: "APPROVED",
    approvedAt: "2026-07-28T10:00:00.000Z",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "AMEND",
    now: "2026-07-29T09:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "AMENDED",
  });
});

it("allows an administrator to amend a note within 24 hours", () => {
  const note: Note = {
    ...baseNote,
    status: "APPROVED",
    approvedAt: "2026-07-28T10:00:00.000Z",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "admin-1",
      role: "ADMIN",
    },
    action: "AMEND",
    now: "2026-07-29T09:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: true,
    nextStatus: "AMENDED",
  });
});

it("does not allow amendment after the 24-hour window", () => {
  const note: Note = {
    ...baseNote,
    status: "APPROVED",
    approvedAt: "2026-07-28T10:00:00.000Z",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "AMEND",
    now: "2026-07-29T10:00:01.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "The 24-hour amendment window has expired.",
  });
});

it("does not allow amendment without an approval timestamp", () => {
  const note: Note = {
    ...baseNote,
    status: "APPROVED",
    approvedAt: undefined,
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "clinician-1",
      role: "CLINICIAN",
    },
    action: "AMEND",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "The Note does not have an approval timestamp.",
  });
});

it("does not allow a reviewer to amend an approved note", () => {
  const note: Note = {
    ...baseNote,
    status: "APPROVED",
    approvedAt: "2026-07-28T10:00:00.000Z",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "AMEND",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Only a Clinician or an Admin can amend an approved Note.",
  });
});

it("does not allow any transition from a locked note", () => {
  const note: Note = {
    ...baseNote,
    status: "LOCKED",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "admin-1",
      role: "ADMIN",
    },
    action: "AMEND",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "Locked notes cannot be transitioned.",
  });
});

it("does not allow an action that is invalid for the current status", () => {
  const note: Note = {
    ...baseNote,
    status: "FAILED",
  };

  const result = canTransition({
    note,
    version: baseVersion,
    actor: {
      id: "reviewer-1",
      role: "REVIEWER",
    },
    action: "APPROVE",
    now: "2026-07-28T11:00:00.000Z",
  });

  expect(result).toEqual({
    allowed: false,
    reason: "APPROVE is not allowed while the note is FAILED.",
  });
});