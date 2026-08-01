import type { PresenceUser, } from "../../../../domain/noteDetail";

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
  return new Date(value).toLocaleString();
}

export function PresencePanel({
  presence,
}: PresencePanelProps) {
  return (
    <section
      className="note-detail-card"
      aria-labelledby="presence-heading"
    >
      <div className="presence-heading">
        <h2 id="presence-heading">
          Presence
        </h2>

        <span className="presence-count">
          {presence.length}
        </span>
      </div>

      {presence.length === 0 ? (
        <p className="presence-empty">
          No other users are currently active
          on this note.
        </p>
      ) : (
        <ul className="presence-list">
          {presence.map((entry) => (
            <li
              className="presence-item"
              key={entry.user.id}
            >
              <div className="presence-avatar">
                {entry.user.displayName
                  .charAt(0)
                  .toUpperCase()}
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
                >
                  Last active:{" "}
                  {formatLastSeen(
                    entry.lastSeenAt,
                  )}
                </time>
              </div>

              <span
                className={
                  entry.activity === "EDITING"
                    ? "presence-activity presence-activity-editing"
                    : "presence-activity"
                }
              >
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