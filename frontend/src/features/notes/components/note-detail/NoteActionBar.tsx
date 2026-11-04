import type {
  AvailableNoteAction,
  UserActionTrigger,
} from "./noteActionBarModel";
import "./NoteActionBar.css";

interface NoteActionBarProps {
  actions: AvailableNoteAction[];
  rejectionReason: string;
  onRejectionReasonChange: (
    value: string,
  ) => void;
  onAction: (
    trigger: UserActionTrigger,
  ) => void;
}

const EXECUTION_STATE_TEXT = {
  IDLE: undefined,
  PENDING: "Action in progress.",
  OPTIMISTICALLY_APPLIED:
    "The action has been applied while the request completes.",
  SUCCEEDED:
    "Action completed successfully.",
  FAILED_AND_ROLLED_BACK:
    "The action failed. The note remains unchanged.",
} satisfies Record<
  AvailableNoteAction["executionState"],
  string | undefined
>;

const PRIMARY_ACTIONS:
  readonly UserActionTrigger[] = [
    "START_REVIEW",
    "APPROVE",
    "RESUBMIT",
  ];

const SECONDARY_ACTIONS:
  readonly UserActionTrigger[] = [
    "RETURN_TO_QUEUE",
    "AMEND",
    "REGENERATE",
  ];

const DESTRUCTIVE_ACTIONS:
  readonly UserActionTrigger[] = [
    "REJECT",
  ];

function getActionsByTrigger(
  actions: AvailableNoteAction[],
  triggers:
    readonly UserActionTrigger[],
): AvailableNoteAction[] {
  const triggerSet =
    new Set(triggers);

  return actions.filter(
    (action) =>
      triggerSet.has(
        action.trigger,
      ),
  );
}

function ActionItem({
  action,
  tone,
  onAction,
}: {
  action: AvailableNoteAction;
  tone:
    | "primary"
    | "secondary"
    | "destructive";
  onAction: (
    trigger: UserActionTrigger,
  ) => void;
}) {
  const disabledReasonId =
    `note-action-${action.trigger}-disabled`;

  const executionStateId =
    `note-action-${action.trigger}-state`;

  const executionText =
    EXECUTION_STATE_TEXT[
      action.executionState
    ];

  const isPending =
    action.executionState ===
    "PENDING";

  const describedBy = [
    !action.enabled &&
    action.disabledReason
      ? disabledReasonId
      : undefined,
    executionText
      ? executionStateId
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="note-action-item"
      data-tone={tone}
    >
      <button
        className={`note-action-button note-action-button--${tone}`}
        type="button"
        disabled={
          !action.enabled ||
          isPending
        }
        aria-describedby={
          describedBy ||
          undefined
        }
        aria-busy={isPending}
        onClick={() =>
          onAction(action.trigger)
        }
      >
        {isPending
          ? `${action.label}…`
          : action.label}
      </button>

      {!action.enabled &&
        action.disabledReason && (
          <p
            id={disabledReasonId}
            className="note-action-disabled-reason"
          >
            {action.disabledReason}
          </p>
        )}

      {executionText && (
        <p
          id={executionStateId}
          className="note-action-execution-state"
          role={
            action.executionState ===
            "FAILED_AND_ROLLED_BACK"
              ? "alert"
              : "status"
          }
        >
          {executionText}
        </p>
      )}
    </div>
  );
}

function ActionGroup({
  heading,
  description,
  tone,
  actions,
  onAction,
}: {
  heading: string;
  description: string;
  tone:
    | "primary"
    | "secondary"
    | "destructive";
  actions: AvailableNoteAction[];
  onAction: (
    trigger: UserActionTrigger,
  ) => void;
}) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <section
      className="note-action-group"
      aria-label={heading}
    >
      <div className="note-action-group__heading">
        <h3>{heading}</h3>
        <p>{description}</p>
      </div>

      <div className="note-action-group__items">
        {actions.map(
          (action) => (
            <ActionItem
              key={action.trigger}
              action={action}
              tone={tone}
              onAction={onAction}
            />
          ),
        )}
      </div>
    </section>
  );
}

export function NoteActionBar({
  actions,
  rejectionReason,
  onRejectionReasonChange,
  onAction,
}: NoteActionBarProps) {
  const rejectAction =
    actions.find(
      (action) =>
        action.trigger ===
        "REJECT",
    );

  const hasPendingAction =
    actions.some(
      (action) =>
        action.executionState ===
        "PENDING",
    );

  const primaryActions =
    getActionsByTrigger(
      actions,
      PRIMARY_ACTIONS,
    );

  const secondaryActions =
    getActionsByTrigger(
      actions,
      SECONDARY_ACTIONS,
    );

  const destructiveActions =
    getActionsByTrigger(
      actions,
      DESTRUCTIVE_ACTIONS,
    );

  return (
    <section
      className="note-detail-card note-action-bar"
      aria-labelledby="note-actions-heading"
    >
      <div className="note-action-bar-heading">
        <div>
          <h2 id="note-actions-heading">
            Workflow actions
          </h2>

          <p>
            Actions are derived from
            the note status, selected
            identity, and reviewer
            assignment.
          </p>
        </div>
      </div>

      {rejectAction && (
        <div className="note-rejection-field">
          <label htmlFor="note-rejection-reason">
            Rejection reason
          </label>

          <textarea
            id="note-rejection-reason"
            value={rejectionReason}
            rows={3}
            disabled={
              hasPendingAction
            }
            placeholder="Explain what the clinician needs to correct."
            onChange={(event) =>
              onRejectionReasonChange(
                event.target.value,
              )
            }
          />
        </div>
      )}

      {actions.length === 0 ? (
        <p className="note-action-empty">
          No workflow actions are
          available for the current
          note status.
        </p>
      ) : (
        <div className="note-action-groups">
          <ActionGroup
            heading="Primary"
            description="Continue the main review workflow."
            tone="primary"
            actions={primaryActions}
            onAction={onAction}
          />

          <ActionGroup
            heading="Other actions"
            description="Return, amend, or regenerate when permitted."
            tone="secondary"
            actions={secondaryActions}
            onAction={onAction}
          />

          <ActionGroup
            heading="Requires attention"
            description="Actions that need additional confirmation or explanation."
            tone="destructive"
            actions={
              destructiveActions
            }
            onAction={onAction}
          />
        </div>
      )}
    </section>
  );
}
