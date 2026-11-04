// Turns a workflow case's codes (assignment "self", approval "25h", ...)
// into the note, version and actor the rules are evaluated on. Shared by
// the case exporter and the frontend contract test; the backend has the
// same logic in tests/test_workflow_contract.py.
import type {
  Note,
  NoteStatus,
  NoteVersion,
  Trigger,
  UserRole,
} from "../frontend/src/domain/noteAttributes";

export const WORKFLOW_CASE_NOW = "2026-08-02T12:00:00.000Z";

export const STATUSES: readonly NoteStatus[] = [
  "GENERATING",
  "FAILED",
  "READY_FOR_REVIEW",
  "IN_REVIEW",
  "REJECTED",
  "APPROVED",
  "AMENDED",
  "LOCKED",
];

export const TRIGGERS: readonly Trigger[] = [
  "GENERATION_COMPLETE",
  "GENERATION_ERROR",
  "REGENERATE",
  "RETURN_TO_QUEUE",
  "APPROVE",
  "REJECT",
  "RESUBMIT",
  "AMEND",
  "GRACE_EXPIRED",
  "START_REVIEW",
];

export const ROLES: readonly UserRole[] = [
  "CLINICIAN",
  "REVIEWER",
  "ADMIN",
  "READONLY_AUDITOR",
];

export type Assignment = "none" | "self" | "other";
export type ReasonCode = "given" | "blank" | "none";
export type ContentCode = "complete" | "blankPlan";
export type ApprovalCode = "missing" | "1h" | "24h" | "25h";

export const ASSIGNMENTS: readonly Assignment[] = ["none", "self", "other"];
export const REASONS: readonly ReasonCode[] = ["given", "blank", "none"];
export const CONTENTS: readonly ContentCode[] = ["complete", "blankPlan"];
export const APPROVALS: readonly ApprovalCode[] = ["missing", "1h", "24h", "25h"];

export interface CaseExtras {
  mfa: boolean;
  reason: ReasonCode;
  content: ContentCode;
  approval: ApprovalCode;
}

const ACTOR_ID = "actor-1";
const OTHER_REVIEWER_ID = "reviewer-other";

const APPROVAL_HOURS_AGO: Record<Exclude<ApprovalCode, "missing">, number> = {
  "1h": 1,
  "24h": 24,
  "25h": 25,
};

export function buildCaseInput(
  status: NoteStatus,
  role: UserRole,
  assignment: Assignment,
  extras: CaseExtras,
): {
  note: Note;
  version: NoteVersion;
  actor: { id: string; role: UserRole; mfaVerified: boolean };
  rejectionReason: string | undefined;
} {
  const approvedAt =
    extras.approval === "missing"
      ? undefined
      : new Date(
          Date.parse(WORKFLOW_CASE_NOW) -
            APPROVAL_HOURS_AGO[extras.approval] * 60 * 60 * 1000,
        ).toISOString();

  return {
    note: {
      id: "note-1",
      patientId: "patient-1",
      sessionId: "session-1",
      status,
      currentVersionId: "version-1",
      assignedReviewerId:
        assignment === "none"
          ? null
          : assignment === "self"
            ? ACTOR_ID
            : OTHER_REVIEWER_ID,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      ...(approvedAt === undefined ? {} : { approvedAt }),
    },
    version: {
      versionId: "version-1",
      noteId: "note-1",
      revisionNumber: 1,
      parentVersionId: null,
      content: {
        subjective: "Reported symptoms.",
        objective: "Stable vitals.",
        assessment: "Improving.",
        plan: extras.content === "blankPlan" ? "   " : "Follow up in two weeks.",
      },
      authorId: "clinician-1",
      authorRole: "CLINICIAN",
      createdAt: "2026-08-01T09:00:00.000Z",
    },
    actor: { id: ACTOR_ID, role, mfaVerified: extras.mfa },
    rejectionReason:
      extras.reason === "given"
        ? "Vitals are missing."
        : extras.reason === "blank"
          ? "   "
          : undefined,
  };
}
