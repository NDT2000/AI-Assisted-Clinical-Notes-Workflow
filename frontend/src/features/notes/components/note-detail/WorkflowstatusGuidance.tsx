import type {
  NoteStatus,
} from "../../../../domain/noteAttributes";
import type {
  NoteDetail,
} from "../../../../domain/noteDetail";
import type {
  TransitionNoteActor,
} from "../../../../domain/noteTransition";
import type {
  AvailableNoteAction,
} from "./noteActionBarModel";
import "./WorkflowStatusGuidance.css";

interface WorkflowStatusGuidanceProps {
  status: NoteStatus;
  actor: TransitionNoteActor;
  assignedReviewer:
    NoteDetail["assignedReviewer"];
  assignedReviewerId:
    string | null;
  actions: AvailableNoteAction[];
}

function getGuidance({
  status,
  actor,
  assignedReviewer,
  assignedReviewerId,
  actions,
}: WorkflowStatusGuidanceProps): {
  title: string;
  message: string;
  tone:
    | "information"
    | "warning"
    | "success";
} {
  if (status === "GENERATING") {
    return {
      title: "Generation in progress",
      message:
        "The server will move this note to Ready for Review when generation completes. Review actions are not available yet.",
      tone: "information",
    };
  }

  if (status === "FAILED") {
    const canRegenerate =
      actions.some(
        (action) =>
          action.trigger ===
            "REGENERATE" &&
          action.enabled,
      );

    return {
      title: "Generation failed",
      message: canRegenerate
        ? "Regenerate is available for this identity."
        : "A clinician or administrator must regenerate this note before review can begin.",
      tone: "warning",
    };
  }

  if (
    status ===
      "READY_FOR_REVIEW" ||
    status === "AMENDED"
  ) {
    if (
      actor.role ===
      "REVIEWER"
    ) {
      if (
        assignedReviewerId ===
        null
      ) {
        return {
          title:
            "Ready to start review",
          message:
            "Select Start Review to assign the note to yourself and move it into review.",
          tone: "information",
        };
      }

      if (
        assignedReviewerId ===
        actor.id
      ) {
        return {
          title:
            "Assigned to you",
          message:
            "Select Start Review to move the note into review.",
          tone: "success",
        };
      }

      return {
        title:
          "Assigned to another reviewer",
        message:
          `You are not the assigned reviewer. ${assignedReviewer?.displayName ?? "Another reviewer"} must start this review.`,
        tone: "warning",
      };
    }

    if (
      actor.role === "ADMIN"
    ) {
      return {
        title:
          "Reviewer assignment available",
        message:
          "Assign a reviewer below. The assigned reviewer can then start the review.",
        tone: "information",
      };
    }

    return {
      title:
        "Waiting for reviewer",
      message:
        "A reviewer must start the review before review actions or reviewer editing become available.",
      tone: "information",
    };
  }

  if (
    status === "IN_REVIEW"
  ) {
    if (
      assignedReviewerId ===
      null
    ) {
      return {
        title:
          "Reviewer assignment missing",
        message:
          "No reviewer is assigned to this in-review note. Approval, rejection, and return actions remain unavailable until the data is corrected.",
        tone: "warning",
      };
    }

    if (
      actor.role ===
        "REVIEWER" &&
      assignedReviewerId !==
        actor.id
    ) {
      return {
        title:
          "Read-only review",
        message:
          `You are not the assigned reviewer. This note is assigned to ${assignedReviewer?.displayName ?? "another reviewer"}.`,
        tone: "warning",
      };
    }

    if (
      actor.role ===
        "REVIEWER" &&
      assignedReviewerId ===
        actor.id
    ) {
      return {
        title:
          "Review in progress",
        message:
          "You are the assigned reviewer. Edit the SOAP note, wait for autosave, and then approve, reject, or return it.",
        tone: "success",
      };
    }

    return {
      title:
        "Review owned by reviewer",
      message:
        `${assignedReviewer?.displayName ?? "The assigned reviewer"} owns the active review. Other roles have read-only access to the review workflow.`,
      tone: "information",
    };
  }

  if (
    status === "REJECTED"
  ) {
    return {
      title:
        "Correction required",
      message:
        actor.role ===
        "CLINICIAN"
          ? "Correct the SOAP content, wait for autosave, and resubmit the note."
          : "A clinician must correct and resubmit this note.",
      tone: "warning",
    };
  }

  if (
    status === "APPROVED"
  ) {
    return {
      title: "Approved note",
      message:
        "The note is approved. An eligible clinician or administrator may start an amendment within the 24-hour grace period.",
      tone: "success",
    };
  }

  return {
    title: "Locked note",
    message:
      "The 24-hour grace period has expired. This note is final and read-only.",
    tone: "information",
  };
}

export function WorkflowStatusGuidance(
  props: WorkflowStatusGuidanceProps,
) {
  const guidance =
    getGuidance(props);

  return (
    <section
      className={`workflow-guidance workflow-guidance--${guidance.tone}`}
      aria-labelledby="workflow-guidance-heading"
    >
      <h2 id="workflow-guidance-heading">
        {guidance.title}
      </h2>

      <p>{guidance.message}</p>
    </section>
  );
}
