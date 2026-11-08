import type {
  Actor,
} from "../../../../domain/actor";
import type {
  NoteDetail,
} from "../../../../domain/noteDetail";
import type {
  AvailableNoteAction,
} from "./noteActionBarModel";
import "./NotePermissionSummary.css";
import {
  formatNoteStatus,
  formatRole,
} from "../../../../shared/formatters";

interface NotePermissionSummaryProps {
  actor: Actor;
  note: NoteDetail["note"];
  assignedReviewer:
    NoteDetail["assignedReviewer"];
  isEditable: boolean;
  actions: AvailableNoteAction[];
}

function getAccessPresentation({
  actor,
  note,
  assignedReviewer,
  isEditable,
  actions,
}: NotePermissionSummaryProps): {
  label: string;
  tone:
    | "editable"
    | "action"
    | "readonly";
  reason: string;
} {
  if (isEditable) {
    return {
      label: "Can edit this note",
      tone: "editable",
      reason:
        "The SOAP editor is available for the selected identity.",
    };
  }

  const enabledAction =
    actions.find(
      (action) =>
        action.enabled,
    );

  if (enabledAction !== undefined) {
    return {
      label: "Workflow action available",
      tone: "action",
      reason:
        `${enabledAction.label} is available for the selected identity.`,
    };
  }

  if (
    actor.role ===
    "READONLY_AUDITOR"
  ) {
    return {
      label: "Read-only access",
      tone: "readonly",
      reason:
        "Auditors can review note content, versions, and history but cannot make changes.",
    };
  }

  if (
    note.status === "LOCKED"
  ) {
    return {
      label: "Read-only access",
      tone: "readonly",
      reason:
        "Locked notes cannot be edited or transitioned.",
    };
  }

  if (
    actor.role === "REVIEWER" &&
    note.assignedReviewerId !==
      null &&
    note.assignedReviewerId !==
      actor.id
  ) {
    return {
      label: "Read-only access",
      tone: "readonly",
      reason:
        assignedReviewer === null
          ? "This note is assigned to another reviewer."
          : `This note is assigned to ${assignedReviewer.displayName}.`,
    };
  }

  const firstDisabledReason =
    actions.find(
      (action) =>
        action.disabledReason !==
        undefined,
    )?.disabledReason;

  return {
    label: "Read-only access",
    tone: "readonly",
    reason:
      firstDisabledReason ??
      "No editing or workflow action is available for this role and note status.",
  };
}

export function NotePermissionSummary(
  props: NotePermissionSummaryProps,
) {
  const {
    actor,
    note,
    assignedReviewer,
  } = props;

  const access =
    getAccessPresentation(
      props,
    );

  return (
    <section
      className="note-permission-summary"
      aria-labelledby="note-permission-heading"
    >
      <div className="note-permission-summary__heading">
        <div>
          <p className="note-permission-summary__eyebrow">
            Current access
          </p>

          <h2 id="note-permission-heading">
            Access for{" "}
            {actor.displayName}
          </h2>
        </div>

        <span
          className={`note-permission-badge note-permission-badge--${access.tone}`}
        >
          {access.label}
        </span>
      </div>

      <dl className="note-permission-summary__details">
        <div>
          <dt>Role</dt>
          <dd>
            {formatRole(actor.role)}
          </dd>
        </div>

        <div>
          <dt>Note status</dt>
          <dd>
            {formatNoteStatus(
              note.status,
            )}
          </dd>
        </div>

        <div>
          <dt>
            Assigned reviewer
          </dt>
          <dd>
            {assignedReviewer
              ?.displayName ??
              "Unassigned"}
          </dd>
        </div>
      </dl>

      <p
        className="note-permission-summary__reason"
        role="status"
        aria-live="polite"
      >
        {access.reason}
      </p>
    </section>
  );
}
