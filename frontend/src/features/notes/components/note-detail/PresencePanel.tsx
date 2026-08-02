import type {
  PresenceUser,
} from "../../../../domain/noteDetail";

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

function formatPresenceCount(
  count: number,
): string {
  return count === 1
    ? "1 active user"
    : `${count} active users`;
}

export function PresencePanel({
  presence,
}: PresencePanelProps) {
  return (
    <section
      className="note-detail-card"
      aria-labelledby="presence-heading"
      aria-live="polite"
      aria-relevant="all"
    >
      <div className="presence-heading">
        <h2 id="presence-heading">
          Presence
        </h2>

        <span
          className="presence-count"
          aria-label={formatPresenceCount(
            presence.length,
          )}
        >
          {presence.length}
        </span>
      </div>

      {presence.length === 0 ? (
        <p className="presence-empty">
          No other users are currently active
          on this note.
        </p>
      ) : (
        <ul
          className="presence-list"
          aria-label="Users currently active on this note"
        >
          {presence.map(entry => (
            <li
              className="presence-item"
              key={entry.user.id}
            >
              <div
                className="presence-avatar"
                aria-hidden="true"
              >
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
                aria-label={`${entry.user.displayName} is ${formatActivity(
                  entry.activity,
                ).toLowerCase()}`}
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
