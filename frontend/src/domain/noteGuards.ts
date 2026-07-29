import type { Note, Trigger, NoteStatus, UserRole, NoteVersion } from "./noteAttributes";
import { noteTransitions } from "./noteTransitions";

export interface Actor{
    id: string;
    role: UserRole;
    mfaVerified?: boolean;
}

export interface Guard {
    note: Note;
    version: NoteVersion;
    actor: Actor;
    action: Trigger;
    rejectionReason?: string;
    now: string;
}

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
    context: Guard
) => GuardResult;

export type TransitionResult =
  | {
      allowed: true;
      nextStatus: NoteStatus;
    }
  | {
      allowed: false;
      reason: string;
    };

// Guard for moving from failed to generating
export const canRegenerate: GuardFunction = ({
    actor,
}) => {
    const canRegenerateNote =
        actor.role === "CLINICIAN" ||
        actor.role === "ADMIN";

        if(!canRegenerateNote) {
            return {
                allowed: false,
                reason: "Only a Clinician or an Administrator can regenerate a note",
            };
        }

        return {
            allowed: true,
            nextStatus: "GENERATING"
        };
};

// Guard for moving from ready_to_review to in_review
export const canStartReview: GuardFunction = ({
    actor,
}) => {
    if (actor.role !== "REVIEWER") {
        return {
            allowed: false,
            reason: "Only a Reviewer can start a review",
        };
    }

    return {
        allowed: true,
        nextStatus: "IN_REVIEW",
    };
};

// Guard for moving from in_review to approve
export const canApprove: GuardFunction = ({
    note,
    actor,
}) => {
    if (actor.role !== "REVIEWER") {
        return {
            allowed: false,
            reason: "Only a Reviewer can approve a Note."
        };
    }

    if (note.assignedReviewerId !== actor.id) {
        return {
            allowed: false,
            reason: "Only an assigned Reviewer can approve this Note."
        };
    }

    if (!actor.mfaVerified) {
        return {
            allowed: false,
            reason: "MFA re-authentication is required to approve this Note."
        };
    }

    return {
        allowed: true,
        nextStatus: "APPROVED"
    };
};

// Guard for moving from in_review to rejected
export const canReject: GuardFunction = ({
    note,
    actor,
    rejectionReason,
}) => {
    if (actor.role !== "REVIEWER") {
        return {
            allowed: false,
            reason: "Only a Reviewer can reject a Note.",
        };
    }

    if (note.assignedReviewerId !== actor.id) {
        return {
            allowed: false,
            reason: "Only an assigned Reviewer can reject this Note.",
        };
    }

    if(!rejectionReason || rejectionReason.trim().length === 0) {
        return {
            allowed: false,
            reason: "A rejection reason is required.",
        };
    }

    return {
        allowed: true,
        nextStatus: "REJECTED",
    };
};

// Guard for moving from rejected to ready_for_review
export const canResubmit: GuardFunction = ({
    version,
    actor,
}) => {
    if (actor.role !== "CLINICIAN") {
        return {
            allowed: false,
            reason: "Only a Clinician can resubmit a Note.",
        };
    }

    const { subjective, objective, assessment, plan } = version.content;

    const hasValidContent =
        subjective.trim().length > 0 &&
        objective.trim().length > 0 &&
        assessment.trim().length > 0 &&
        plan.trim().length > 0;

    if(!hasValidContent) {
        return {
            allowed: false,
            reason: "All SOAP content must be completed before resubmission."
        };
    }

    return {
        allowed: true,
        nextStatus: "READY_FOR_REVIEW",
    };
};

export const canAmend: GuardFunction = ({
  note,
  actor,
  now,
}) => {
  const isAllowedRole =
    actor.role === "CLINICIAN" ||
    actor.role === "ADMIN";

  if (!isAllowedRole) {
    return {
      allowed: false,
      reason: "Only a Clinician or an Admin can amend an approved Note.",
    };
  }

  if (!note.approvedAt) {
    return {
      allowed: false,
      reason: "The Note does not have an approval timestamp.",
    };
  }

  const approvedTime = new Date(note.approvedAt).getTime();
  const currentTime = new Date(now).getTime();

  const twentyFourHoursInMilliseconds =
    24 * 60 * 60 * 1000;

  const amendmentDeadline =
    approvedTime + twentyFourHoursInMilliseconds;

  if (currentTime > amendmentDeadline) {
    return {
      allowed: false,
      reason: "The 24-hour amendment window has expired.",
    };
  }

  return {
    allowed: true,
    nextStatus: "AMENDED",
  };
};

export const canReturnToQueue: GuardFunction = ({
  note,
  actor,
}) => {
  if (actor.role !== "REVIEWER") {
    return {
      allowed: false,
      reason: "Only a reviewer can return a note to the queue.",
    };
  }

  if (note.assignedReviewerId !== actor.id) {
    return {
      allowed: false,
      reason: "Only the assigned reviewer can return this note.",
    };
  }

  return {
    allowed: true,
    nextStatus: "READY_FOR_REVIEW",
  };
};

export function canTransition(
  context: Guard,
): GuardResult {
  const { note, action } = context;

  if (note.status === "LOCKED") {
    return {
      allowed: false,
      reason: "Locked notes cannot be transitioned.",
    };
  }

  const nextStatus =
    noteTransitions[note.status][action];

  if (!nextStatus) {
    return {
      allowed: false,
      reason: `${action} is not allowed while the note is ${note.status}.`,
    };
  }

  const guard = guards[action];

  if (guard) {
    const guardResult = guard(context);

    if (!guardResult.allowed) {
      return guardResult;
    }
  }

  return {
    allowed: true,
    nextStatus,
  };
}

export const guards: Partial<
  Record<Trigger, GuardFunction>
> = {
  REGENERATE: canRegenerate,
  START_REVIEW: canStartReview,
  RETURN_TO_QUEUE: canReturnToQueue,
  APPROVE: canApprove,
  REJECT: canReject,
  RESUBMIT: canResubmit,
  AMEND: canAmend,
};