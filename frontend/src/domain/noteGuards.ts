import type { Note, NoteStatus, NoteVersion, Trigger, UserRole, } from "./noteAttributes";
import { noteTransitions, } from "./noteTransitions";
import {
  formatWorkflowMessage,
  noteWorkflow,
  type WorkflowGuard,
} from "./noteWorkflow";

import type { Actor } from "./actor";

/*
 * The workflow rules. What they allow, and every message, comes from
 * contract/note-workflow.json, shared with the backend.
 */

/* Guards only need to know who is acting and how they authenticated. */
export type GuardActor = Pick<Actor, "id" | "role" | "mfaVerified">;

export interface Guard {
  note: Note;
  version: NoteVersion;
  actor: GuardActor;
  action: Trigger;
  rejectionReason?: string;
  now: string;
}

export type PermissionResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

export type GuardResult =
  | {
      allowed: true;
      nextStatus: NoteStatus;
    }
  | {
      allowed: false;
      reason: string;
    };

export type GuardFunction = (
  context: Guard,
) => GuardResult;

export type TransitionResult =
  GuardResult;

const HOUR_MS = 60 * 60 * 1000;

function deny(
  reason: string | undefined,
): { allowed: false; reason: string } {
  return {
    allowed: false,
    reason: reason ?? "This action is not allowed.",
  };
}

function hasCompleteContent(
  version: NoteVersion,
): boolean {
  const {
    subjective,
    objective,
    assessment,
    plan,
  } = version.content;

  return [
    subjective,
    objective,
    assessment,
    plan,
  ].every(section => section.trim().length > 0);
}

/*
 * Runs one trigger's guard: role first, then reviewer ownership, then
 * the trigger's own conditions, in the order the contract lists them.
 */
function checkGuard(
  guard: WorkflowGuard,
  {
    note,
    version,
    actor,
    rejectionReason,
    now,
  }: Guard,
): PermissionResult {
  const { messages } = guard;

  if (!guard.roles.includes(actor.role)) {
    return deny(messages.role);
  }

  if (
    guard.reviewer === "assigned" &&
    note.assignedReviewerId !== actor.id
  ) {
    return deny(messages.reviewer);
  }

  if (
    guard.reviewer === "unassignedOrAssigned" &&
    note.assignedReviewerId !== null &&
    note.assignedReviewerId !== actor.id
  ) {
    return deny(messages.reviewer);
  }

  if (guard.requireMfa && !actor.mfaVerified) {
    return deny(messages.mfa);
  }

  if (
    guard.requireRejectionReason &&
    (!rejectionReason ||
      rejectionReason.trim().length === 0)
  ) {
    return deny(messages.rejectionReason);
  }

  if (
    guard.requireCompleteContent &&
    !hasCompleteContent(version)
  ) {
    return deny(messages.content);
  }

  if (guard.withinHoursOfApproval !== undefined) {
    if (!note.approvedAt) {
      return deny(messages.approvalMissing);
    }

    const deadline =
      new Date(note.approvedAt).getTime() +
      guard.withinHoursOfApproval * HOUR_MS;

    if (new Date(now).getTime() > deadline) {
      return deny(messages.approvalWindow);
    }
  }

  return { allowed: true };
}

export function canManageReviewerAssignments(
  actorRole: UserRole,
): PermissionResult {
  const rule = noteWorkflow.reviewerAssignment;

  if (!rule.roles.includes(actorRole)) {
    return deny(rule.roleMessage);
  }

  return { allowed: true };
}

export function canAssignReviewer(
  status: NoteStatus,
  actorRole: UserRole,
): PermissionResult {
  const rolePermission =
    canManageReviewerAssignments(actorRole);

  if (!rolePermission.allowed) {
    return rolePermission;
  }

  const rule = noteWorkflow.reviewerAssignment;

  if (!rule.statuses.includes(status)) {
    return deny(rule.statusMessage);
  }

  return { allowed: true };
}

export function canEditNoteContent(
  note: Note,
  actor: GuardActor,
): PermissionResult {
  const rules = noteWorkflow.contentEditing;

  const deniedRoleMessage =
    rules.deniedRoles[actor.role];

  if (deniedRoleMessage !== undefined) {
    return deny(deniedRoleMessage);
  }

  if (note.status === noteWorkflow.lockedStatus) {
    return deny(rules.lockedMessage);
  }

  const rule = rules.byRole[actor.role];

  if (rule === undefined) {
    return deny(rules.defaultMessage);
  }

  if (!rule.statuses.includes(note.status)) {
    return deny(rule.statusMessage);
  }

  if (
    rule.assignedReviewerOnly &&
    note.assignedReviewerId !== actor.id
  ) {
    return deny(rule.assignedReviewerMessage);
  }

  return { allowed: true };
}

/* For bulk regeneration, where only the status and role are known. */
export function canRequestRegeneration(
  status: NoteStatus,
  actorRole: UserRole,
): GuardResult {
  const { trigger, statusMessage } =
    noteWorkflow.regeneration;

  const nextStatus =
    noteTransitions[status][trigger];

  if (nextStatus === undefined) {
    return deny(statusMessage);
  }

  const guard = noteWorkflow.guards[trigger];

  if (
    guard !== undefined &&
    !guard.roles.includes(actorRole)
  ) {
    return deny(guard.messages.role);
  }

  return {
    allowed: true,
    nextStatus,
  };
}

export function canTransition(
  context: Guard,
): GuardResult {
  const {
    note,
    action,
  } = context;

  if (note.status === noteWorkflow.lockedStatus) {
    return deny(noteWorkflow.messages.locked);
  }

  const nextStatus =
    noteTransitions[note.status][action];

  if (!nextStatus) {
    return deny(
      formatWorkflowMessage(
        noteWorkflow.messages.notAllowed,
        {
          trigger: action,
          status: note.status,
        },
      ),
    );
  }

  const guard = noteWorkflow.guards[action];

  if (guard) {
    const guardResult = checkGuard(
      guard,
      context,
    );

    if (!guardResult.allowed) {
      return guardResult;
    }
  }

  return {
    allowed: true,
    nextStatus,
  };
}
