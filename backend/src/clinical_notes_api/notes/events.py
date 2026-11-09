"""The note event log: what real-time clients are told, and how they catch up.

Every saved version and every workflow action adds one event, in the same
transaction as the change. Events are numbered in commit order (see
`record_event`), so "everything after N" is exactly what a client that has
seen event N is missing.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy import event as sa_event
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from clinical_notes_api.db import NoteEvent, NoteEventLogState
from clinical_notes_api.db.models import NoteEventType
from clinical_notes_api.notes.schemas import to_iso

# Any constant works; it only has to be the same for every writer.
EVENT_LOG_LOCK_KEY = 7_240_001
DEFAULT_PAGE_SIZE = 500
# Where a session keeps the messages of events it recorded until commit.
PENDING_MESSAGES = "pending_note_event_messages"


def record_event(
    session: Session,
    *,
    note_id: str,
    event_type: NoteEventType,
    payload: dict[str, Any],
    occurred_at: datetime,
    trigger: str | None = None,
) -> NoteEvent:
    """Add an event to the log, as part of the caller's transaction.

    The lock is held until the transaction ends, so the next writer gets its
    number only after this one has committed (or rolled back). Without it, a
    later number could commit first, and a client reading in between would
    move past the earlier one and never see it. Writers already hold their
    notes' locks, and this is the last lock they take, so it cannot deadlock.
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": EVENT_LOG_LOCK_KEY},
    )
    event = NoteEvent(
        event_id=f"note-event-{uuid.uuid4()}",
        note_id=note_id,
        type=event_type,
        trigger=trigger,
        payload=payload,
        occurred_at=occurred_at,
    )
    session.add(event)
    session.flush()
    # Sent to live clients only once the transaction commits (see
    # publish_after_commit), never for a change that is rolled back.
    session.info.setdefault(PENDING_MESSAGES, []).append(event_message(event))
    return event


def publish_after_commit(
    session_factory: sessionmaker[Session],
    publish: Callable[[dict[str, Any]], None],
) -> None:
    """Hand each committed event to `publish`, in the order recorded."""

    @sa_event.listens_for(session_factory, "after_commit")
    def _after_commit(session: Session) -> None:
        for message in session.info.pop(PENDING_MESSAGES, []):
            publish(message)

    @sa_event.listens_for(session_factory, "after_soft_rollback")
    def _after_rollback(session: Session, previous_transaction) -> None:
        if not previous_transaction.nested:
            session.info.pop(PENDING_MESSAGES, None)


def event_message(event: NoteEvent) -> dict[str, Any]:
    """An event as clients receive it (the frontend's NoteRealtimeEvent)."""
    message: dict[str, Any] = {
        "eventId": event.event_id,
        "cursor": event.cursor,
        "noteId": event.note_id,
        "occurredAt": to_iso(event.occurred_at),
        "type": event.type,
        "response": event.payload,
    }
    if event.trigger is not None:
        message["trigger"] = event.trigger
    return message


@dataclass(frozen=True)
class EventsPage:
    events: list[dict[str, Any]]
    # More events follow the last one; ask again after its cursor.
    has_more: bool
    # Events after the client's cursor no longer exist (they were pruned,
    # or the log was reset): reload the notes instead of catching up.
    reset_required: bool


def events_after(
    session: Session,
    note_ids: Sequence[str],
    after: int,
    limit: int = DEFAULT_PAGE_SIZE,
) -> EventsPage:
    """The events for these notes after cursor `after`, oldest first."""
    after = max(0, after)

    if after < pruned_through(session) or after > latest_cursor(session):
        return EventsPage(events=[], has_more=False, reset_required=True)

    if not note_ids:
        return EventsPage(events=[], has_more=False, reset_required=False)

    rows = session.scalars(
        select(NoteEvent)
        .where(NoteEvent.note_id.in_(list(note_ids)), NoteEvent.cursor > after)
        .order_by(NoteEvent.cursor)
        .limit(limit + 1)
    ).all()

    return EventsPage(
        events=[event_message(event) for event in rows[:limit]],
        has_more=len(rows) > limit,
        reset_required=False,
    )


def pruned_through(session: Session) -> int:
    return session.scalar(select(NoteEventLogState.pruned_through)) or 0


def latest_cursor(session: Session) -> int:
    """The highest event number handed out so far (0 before the first).

    Read from the numbering itself, not the table, so it stays right when
    the newest events have been pruned.
    """
    # Null until the first number is handed out.
    last_value = session.scalar(
        text(
            "SELECT pg_sequence_last_value("
            "pg_get_serial_sequence('note_events', 'cursor'))"
        )
    )
    return last_value or 0


def prune_events(session: Session, before: datetime) -> int:
    """Remove events older than `before`; returns how many were removed.

    Remembers the highest removed number, so a client that last saw an
    earlier event is told to reload instead of silently missing some.
    """
    removed = session.scalars(
        delete(NoteEvent)
        .where(NoteEvent.occurred_at < before)
        .returning(NoteEvent.cursor)
    ).all()

    if removed:
        highest = max(removed)
        statement = insert(NoteEventLogState).values(id=1, pruned_through=highest)
        session.execute(
            statement.on_conflict_do_update(
                index_elements=[NoteEventLogState.id],
                set_={
                    "pruned_through": func.greatest(
                        NoteEventLogState.pruned_through,
                        statement.excluded.pruned_through,
                    )
                },
            )
        )

    return len(removed)
