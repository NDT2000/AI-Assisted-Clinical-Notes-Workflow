import { formatDateTime } from "../../../../shared/formatters";
import type { MissedChange } from "../../realtime/missedChanges";
import "./WhileAwayPanel.css";

export interface WhileAwayConflict {
  // Sections both sides changed; empty when the edits do not overlap.
  overlappingSections: string[];
}

interface WhileAwayPanelProps {
  changes: readonly MissedChange[];
  // Set when an offline edit to this note is waiting on a conflict.
  conflict: WhileAwayConflict | null;
  // Why this user's offline edits cannot be saved now, if they cannot.
  refusedReason: string | null;
  onResolve: () => void;
  onDismiss: () => void;
}

function conflictWords(conflict: WhileAwayConflict): string {
  return conflict.overlappingSections.length > 0
    ? `overlaps your offline edit to ${conflict.overlappingSections.join(", ")} — choose what to keep`
    : "doesn't overlap your offline edits — confirm the merge";
}

/*
 * What changed while this page was disconnected, shown after it catches
 * up. Points out where those changes meet this user's offline edits.
 */
export function WhileAwayPanel({
  changes,
  conflict,
  refusedReason,
  onResolve,
  onDismiss,
}: WhileAwayPanelProps) {
  if (changes.length === 0) {
    return null;
  }

  const lastVersion = [...changes]
    .reverse()
    .find((change) => change.kind === "version");

  return (
    <section
      className="while-away-panel"
      role="status"
      aria-live="polite"
      aria-labelledby="while-away-heading"
    >
      <h2 id="while-away-heading">
        {changes.length === 1
          ? "1 change while you were away"
          : `${changes.length} changes while you were away`}
      </h2>

      <ul>
        {changes.map((change) => (
          <li key={change.eventId}>
            <span>
              {change.actorName} {change.description}
            </span>{" "}
            <time dateTime={change.occurredAt}>
              · {formatDateTime(change.occurredAt)}
            </time>
            {conflict !== null && change === lastVersion && (
              <strong className="while-away-panel__conflict">
                {" "}
                — {conflictWords(conflict)}
              </strong>
            )}
          </li>
        ))}
      </ul>

      {refusedReason !== null && (
        <p className="while-away-panel__refused">
          Your offline edits can't be saved: {refusedReason}
        </p>
      )}

      <div className="while-away-panel__actions">
        {conflict !== null && (
          <button type="button" onClick={onResolve}>
            Resolve
          </button>
        )}
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
