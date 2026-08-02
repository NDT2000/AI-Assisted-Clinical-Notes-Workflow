import type { Note, NoteStatus, NoteVersion, Trigger, UserRole, } from "./noteAttributes";
import { noteTransitions, } from "./noteTransitions";

export interface Actor {
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

export function canManageReviewerAssignments(
  actorRole: UserRole,
): PermissionResult {
  if (
    actorRole !== "CLINICIAN" &&
    actorRole !== "ADMIN"
  ) {
    return {
      allowed: false,
      reason:
        "Only a Clinician or an Administrator can assign reviewers.",
    };
  }

  return {
    allowed: true,
  };
}

export function canAssignReviewer(
  status: NoteStatus,
  actorRole: UserRole,
): PermissionResult {
  const rolePermission =
    canManageReviewerAssignments(
      actorRole,
    );

  if (!rolePermission.allowed) {
    return rolePermission;
  }

  if (
    status !==
      "READY_FOR_REVIEW" &&
    status !== "AMENDED"
  ) {
    return {
      allowed: false,
      reason:
        "Reviewer assignment is available only for notes that are ready for review or amended.",
    };
  }

  return {
    allowed: true,
  };
}

export function canEditNoteContent(
  note: Note,
  actor: Actor,
): PermissionResult {
  if (
    actor.role ===
    "READONLY_AUDITOR"
  ) {
    return {
      allowed: false,
      reason:
        "Read-only auditors cannot edit note content.",
    };
  }

  if (note.status === "LOCKED") {
    return {
      allowed: false,
      reason:
        "Locked notes are read-only.",
    };
  }

  if (actor.role === "REVIEWER") {
    if (
      note.status !==
      "IN_REVIEW"
    ) {
      return {
        allowed: false,
        reason:
          "Reviewers can edit only notes that are in review.",
      };
    }

    if (
      note.assignedReviewerId !==
      actor.id
    ) {
      return {
        allowed: false,
        reason:
          "Only the assigned reviewer can edit this note.",
      };
    }

    return {
      allowed: true,
    };
  }

  if (actor.role === "CLINICIAN") {
    if (
      note.status !==
        "REJECTED" &&
      note.status !==
        "AMENDED"
    ) {
      return {
        allowed: false,
        reason:
          "Clinicians can edit rejected or amended notes.",
      };
    }

    return {
      allowed: true,
    };
  }

  if (actor.role === "ADMIN") {
    if (
      note.status !==
        "IN_REVIEW" &&
      note.status !==
        "REJECTED" &&
      note.status !==
        "AMENDED"
    ) {
      return {
        allowed: false,
        reason:
          "Administrators can edit only active review, rejected, or amended notes.",
      };
    }

    return {
      allowed: true,
    };
  }

  return {
    allowed: false,
    reason:
      "You are not authorized to edit this note.",
  };
}

export function canRequestRegeneration(
  status: NoteStatus,
  actorRole: UserRole,
): GuardResult {
  if (status !== "FAILED") {
    return {
      allowed: false,
      reason:
        "Only failed notes can be regenerated.",
    };
  }

  const isAllowedRole =
    actorRole === "CLINICIAN" ||
    actorRole === "ADMIN";

  if (!isAllowedRole) {
    return {
      allowed: false,
      reason:
        "Only a Clinician or an Administrator can regenerate a note.",
    };
  }

  return {
    allowed: true,
    nextStatus: "GENERATING",
  };
}

export const canRegenerate:
  GuardFunction = ({
    note,
    actor,
  }) =>
    canRequestRegeneration(
      note.status,
      actor.role,
    );

export const canStartReview:
  GuardFunction = ({
    note,
    actor,
  }) => {
    if (
      actor.role !== "REVIEWER"
    ) {
      return {
        allowed: false,
        reason:
          "Only a Reviewer can start a review.",
      };
    }

    if (
      note.assignedReviewerId !==
        null &&
      note.assignedReviewerId !==
        actor.id
    ) {
      return {
        allowed: false,
        reason:
          "This note is assigned to another reviewer.",
      };
    }

    return {
      allowed: true,
      nextStatus: "IN_REVIEW",
    };
  };

export const canApprove:
  GuardFunction = ({
    note,
    actor,
  }) => {
    if (
      actor.role !== "REVIEWER"
    ) {
      return {
        allowed: false,
        reason:
          "Only a Reviewer can approve a note.",
      };
    }

    if (
      note.assignedReviewerId !==
      actor.id
    ) {
      return {
        allowed: false,
        reason:
          "Only the assigned reviewer can approve this note.",
      };
    }

    if (!actor.mfaVerified) {
      return {
        allowed: false,
        reason:
          "MFA re-authentication is required to approve this note.",
      };
    }

    return {
      allowed: true,
      nextStatus: "APPROVED",
    };
  };

export const canReject:
  GuardFunction = ({
    note,
    actor,
    rejectionReason,
  }) => {
    if (
      actor.role !== "REVIEWER"
    ) {
      return {
        allowed: false,
        reason:
          "Only a Reviewer can reject a note.",
      };
    }

    if (
      note.assignedReviewerId !==
      actor.id
    ) {
      return {
        allowed: false,
        reason:
          "Only the assigned reviewer can reject this note.",
      };
    }

    if (
      !rejectionReason ||
      rejectionReason.trim()
        .length === 0
    ) {
      return {
        allowed: false,
        reason:
          "A rejection reason is required.",
      };
    }

    return {
      allowed: true,
      nextStatus: "REJECTED",
    };
  };

export const canResubmit:
  GuardFunction = ({
    version,
    actor,
  }) => {
    if (
      actor.role !== "CLINICIAN"
    ) {
      return {
        allowed: false,
        reason:
          "Only a Clinician can resubmit a note.",
      };
    }

    const {
      subjective,
      objective,
      assessment,
      plan,
    } = version.content;

    const hasValidContent =
      subjective.trim().length >
        0 &&
      objective.trim().length >
        0 &&
      assessment.trim().length >
        0 &&
      plan.trim().length > 0;

    if (!hasValidContent) {
      return {
        allowed: false,
        reason:
          "All SOAP content must be completed before resubmission.",
      };
    }

    return {
      allowed: true,
      nextStatus:
        "READY_FOR_REVIEW",
    };
  };

export const canAmend:
  GuardFunction = ({
    note,
    actor,
    now,
  }) => {
    const isAllowedRole =
      actor.role ===
        "CLINICIAN" ||
      actor.role === "ADMIN";

    if (!isAllowedRole) {
      return {
        allowed: false,
        reason:
          "Only a Clinician or an Administrator can amend an approved note.",
      };
    }

    if (!note.approvedAt) {
      return {
        allowed: false,
        reason:
          "The note does not have an approval timestamp.",
      };
    }

    const approvedTime =
      new Date(
        note.approvedAt,
      ).getTime();

    const currentTime =
      new Date(now).getTime();

    const amendmentDeadline =
      approvedTime +
      24 * 60 * 60 * 1000;

    if (
      currentTime >
      amendmentDeadline
    ) {
      return {
        allowed: false,
        reason:
          "The 24-hour amendment window has expired.",
      };
    }

    return {
      allowed: true,
      nextStatus: "AMENDED",
    };
  };

export const canReturnToQueue:
  GuardFunction = ({
    note,
    actor,
  }) => {
    if (
      actor.role !== "REVIEWER"
    ) {
      return {
        allowed: false,
        reason:
          "Only a Reviewer can return a note to the queue.",
      };
    }

    if (
      note.assignedReviewerId !==
      actor.id
    ) {
      return {
        allowed: false,
        reason:
          "Only the assigned reviewer can return this note.",
      };
    }

    return {
      allowed: true,
      nextStatus:
        "READY_FOR_REVIEW",
    };
  };

export function canTransition(
  context: Guard,
): GuardResult {
  const {
    note,
    action,
  } = context;

  if (note.status === "LOCKED") {
    return {
      allowed: false,
      reason:
        "Locked notes cannot be transitioned.",
    };
  }

  const nextStatus =
    noteTransitions[note.status][
      action
    ];

  if (!nextStatus) {
    return {
      allowed: false,
      reason:
        `${action} is not allowed while the note is ${note.status}.`,
    };
  }

  const guard =
    guards[action];

  if (guard) {
    const guardResult =
      guard(context);

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
  Record<
    Trigger,
    GuardFunction
  >
> = {
  REGENERATE: canRegenerate,
  START_REVIEW: canStartReview,
  RETURN_TO_QUEUE: canReturnToQueue,
  APPROVE: canApprove,
  REJECT: canReject,
  RESUBMIT: canResubmit,
  AMEND: canAmend,
};
