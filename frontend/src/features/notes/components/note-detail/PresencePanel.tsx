import type {
  PresenceUser,
} from "../../../../domain/noteDetail";
import "./css/PresencePanel.css";

interface PresencePanelProps {
  presence: PresenceUser[];
}

function formatActivity(
  activity: PresenceUser["activity"],
): string {
  switch (activity) {
    case "EDITING":
      return "Editing";

    case "VIEWING":
      return "Viewing";
  }
}

function formatLastSeen(
  value: string,
): string {
  return new Date(
    value,
  ).toLocaleString();
}

function getInitials(
  displayName: string,
): string {
  const parts =
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0]
      .slice(0, 1)
      .toUpperCase();
  }

  return (
    parts[0].slice(0, 1) +
    parts[
      parts.length - 1
    ].slice(0, 1)
  ).toUpperCase();
}

export function PresencePanel({
  presence,
}: PresencePanelProps) {
  const editorCount =
    presence.filter(
      (entry) =>
        entry.activity ===
        "EDITING",
    ).length;

  return (
    <section
      className="note-detail-card presence-panel"
      aria-labelledby="presence-heading"
    >
      <div className="presence-heading">
        <div>
          <p className="presence-eyebrow">
            Live collaboration
          </p>

          <h2 id="presence-heading">
            Presence
          </h2>

          <p>
            Users currently connected to
            this note.
          </p>
        </div>

        <span
          className="presence-count"
          aria-label={`${presence.length} active users`}
        >
          {presence.length}
        </span>
      </div>

      {editorCount > 0 && (
        <p
          className="presence-editing-notice"
          role="status"
          aria-live="polite"
        >
          {editorCount === 1
            ? "Another user is editing this note."
            : `${editorCount} other users are editing this note.`}
        </p>
      )}

      {presence.length === 0 ? (
        <p
          className="presence-empty"
          role="status"
          aria-live="polite"
        >
          No other users are currently active
          on this note.
        </p>
      ) : (
        <ul
          className="presence-list"
          aria-live="polite"
          aria-relevant="all"
        >
          {presence.map((entry) => (
            <li
              className="presence-item"
              data-activity={
                entry.activity
              }
              key={entry.user.id}
            >
              <div
                className="presence-avatar"
                aria-hidden="true"
              >
                {getInitials(
                  entry.user.displayName,
                )}
              </div>

              <div className="presence-user-details">
                <strong>
                  {entry.user.displayName}
                </strong>

                <span>
                  {entry.user.role}
                </span>

                <time
                  dateTime={entry.lastSeenAt}
                  title={formatLastSeen(
                    entry.lastSeenAt,
                  )}
                >
                  Last active{" "}
                  {formatLastSeen(
                    entry.lastSeenAt,
                  )}
                </time>
              </div>

              <span
                className={
                  entry.activity ===
                  "EDITING"
                    ? "presence-activity presence-activity-editing"
                    : "presence-activity"
                }
              >
                <span
                  className="presence-activity-dot"
                  aria-hidden="true"
                />

                {formatActivity(
                  entry.activity,
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
