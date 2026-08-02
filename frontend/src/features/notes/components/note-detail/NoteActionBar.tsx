import type {
  AvailableNoteAction,
  UserActionTrigger,
} from "./noteActionBarModel";

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

export function NoteActionBar({
  actions,
  rejectionReason,
  onRejectionReasonChange,
  onAction,
}: NoteActionBarProps) {
  const rejectAction = actions.find(
    action =>
      action.trigger === "REJECT",
  );

  const hasPendingAction =
    actions.some(
      action =>
        action.executionState ===
        "PENDING",
    );

  return (
    <section
      className="note-detail-card note-action-bar"
      aria-labelledby="note-actions-heading"
      aria-busy={hasPendingAction}
    >
      <div className="note-action-bar-heading">
        <div>
          <h2 id="note-actions-heading">
            Note actions
          </h2>

          <p>
            Available actions are determined by
            the note workflow.
          </p>
        </div>
      </div>

      {rejectAction && (
        <div className="note-rejection-field">
          <label htmlFor="note-rejection-reason">
            Rejection reason
          </label>

          <p id="note-rejection-reason-help">
            Required before the Reject action
            can be submitted.
          </p>

          <textarea
            id="note-rejection-reason"
            value={rejectionReason}
            rows={3}
            disabled={hasPendingAction}
            aria-describedby="note-rejection-reason-help"
            onChange={event =>
              onRejectionReasonChange(
                event.target.value,
              )
            }
          />
        </div>
      )}

      {actions.length === 0 ? (
        <p className="note-action-empty">
          No user actions are available for the
          current note status.
        </p>
      ) : (
        <div
          className="note-action-list"
          aria-live="polite"
          aria-relevant="text"
        >
          {actions.map(action => {
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
                key={action.trigger}
              >
                <button
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
                    aria-atomic="true"
                  >
                    {executionText}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
