import type { ReviewTimelineEvent, } from "../../../domain/noteDetail";

interface ReviewTimelineProps {
  events: ReviewTimelineEvent[];
}

function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

function formatRole(
  role: ReviewTimelineEvent["actorRole"],
): string {
  return role
    .toLowerCase()
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1),
    )
    .join(" ");
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function ReviewTimeline({
  events,
}: ReviewTimelineProps) {
  const orderedEvents = [...events].sort(
    (firstEvent, secondEvent) => {
      const dateDifference =
        new Date(firstEvent.occurredAt).getTime() -
        new Date(secondEvent.occurredAt).getTime();

      if (dateDifference !== 0) {
        return dateDifference;
      }

      return firstEvent.eventId.localeCompare(
        secondEvent.eventId,
      );
    },
  );

  return (
    <section
      className="note-detail-card"
      aria-labelledby="review-timeline-heading"
    >
      <div className="review-timeline-heading">
        <h2 id="review-timeline-heading">
          Review timeline
        </h2>

        <span className="review-timeline-count">
          {events.length}
        </span>
      </div>

      {orderedEvents.length === 0 ? (
        <p className="review-timeline-empty">
          No workflow events have been recorded
          for this note.
        </p>
      ) : (
        <ol className="review-timeline-list">
          {orderedEvents.map((event) => (
            <li
              className="review-timeline-item"
              key={event.eventId}
            >
              <div
                className="review-timeline-marker"
                aria-hidden="true"
              />

              <div className="review-timeline-content">
                <div className="review-timeline-transition">
                  <strong>
                    {formatStatus(
                      event.fromStatus,
                    )}
                  </strong>

                  <span aria-hidden="true">
                    →
                  </span>

                  <strong>
                    {formatStatus(
                      event.toStatus,
                    )}
                  </strong>
                </div>

                <p className="review-timeline-actor">
                  {event.actorDisplayName}
                  {" · "}
                  {formatRole(event.actorRole)}
                </p>

                {event.reason && (
                  <p className="review-timeline-reason">
                    {event.reason}
                  </p>
                )}

                <time
                  className="review-timeline-time"
                  dateTime={event.occurredAt}
                >
                  {formatDateTime(
                    event.occurredAt,
                  )}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}