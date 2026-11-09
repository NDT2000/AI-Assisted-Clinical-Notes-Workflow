"""The note event log: what each change records, catching up, and pruning.

Uses the note API fixtures from conftest.py: 60 seeded notes, and every test
runs in a transaction that is rolled back afterwards.
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from clinical_notes_api.config import Settings
from clinical_notes_api.db import NoteEvent, NoteEventLogState
from clinical_notes_api.notes import prune_events as prune_command
from clinical_notes_api.notes.events import (
    events_after,
    latest_cursor,
    prune_events,
    record_event,
)
from tests.note_api import content, current_version_id

FAILED_NOTE = "note-000002"
IN_REVIEW_NOTE = "note-000003"  # reviewer-1
LOCKED_NOTE = "note-000006"
READY_NOTE = "note-000012"  # reviewer-2


def save(client: TestClient, headers: dict, note_id: str, mutation_id: str = "save-1"):
    return client.post(
        f"/api/notes/{note_id}/versions",
        json={
            "baseVersionId": current_version_id(client, headers, note_id),
            "clientMutationId": mutation_id,
            "content": content(plan="Event log check."),
        },
        headers=headers,
    )


def transition(
    client: TestClient,
    headers: dict,
    note_id: str,
    trigger: str,
    mutation_id: str = "action-1",
):
    return client.post(
        f"/api/notes/{note_id}/transitions",
        json={
            "baseVersionId": current_version_id(client, headers, note_id),
            "clientMutationId": mutation_id,
            "trigger": trigger,
        },
        headers=headers,
    )


def events(db: Session, note_id: str | None = None) -> list[NoteEvent]:
    query = select(NoteEvent).order_by(NoteEvent.cursor)
    if note_id is not None:
        query = query.where(NoteEvent.note_id == note_id)
    return list(db.scalars(query))


# --- What gets recorded -----------------------------------------------------


def test_a_saved_version_records_its_response(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    response = save(client, as_user("reviewer-1"), IN_REVIEW_NOTE)

    assert response.status_code == 201
    [event] = events(db)
    assert event.note_id == IN_REVIEW_NOTE
    assert event.type == "note.version_added"
    assert event.trigger is None
    # Exactly what the saver was told, so clients apply it the same way.
    assert event.payload == response.json()
    assert event.payload["savedVersion"]["authorDisplayName"] == "Alex Kim"


def test_a_workflow_action_records_its_response_and_trigger(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    response = transition(client, as_user("reviewer-2"), READY_NOTE, "START_REVIEW")

    assert response.status_code == 200
    [event] = events(db)
    assert (event.type, event.trigger) == ("note.status_changed", "START_REVIEW")
    assert event.payload == response.json()
    assert event.payload["timelineEvent"]["actorDisplayName"] == "Sam Rivera"


def test_bulk_regeneration_records_one_event_per_changed_note(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    response = client.post(
        "/api/notes/bulk/regenerate",
        json={"noteIds": [FAILED_NOTE, READY_NOTE]},
        headers=as_user("admin-1"),
    )

    assert response.json()["updated"] == [FAILED_NOTE]
    [event] = events(db)
    assert (event.note_id, event.trigger) == (FAILED_NOTE, "REGENERATE")
    assert event.payload["note"]["status"] == "GENERATING"
    assert event.payload["timelineEvent"]["toStatus"] == "GENERATING"
    assert event.payload["clientMutationId"].startswith("bulk-")
    assert event.payload["currentVersion"]["noteId"] == FAILED_NOTE


def test_reviewer_assignment_records_nothing(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    client.post(
        "/api/notes/bulk/assign-reviewer",
        json={"noteIds": [READY_NOTE], "reviewerId": "reviewer-5"},
        headers=as_user("admin-1"),
    )

    assert events(db) == []


def test_refused_and_repeated_changes_record_nothing_more(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    reviewer = as_user("reviewer-1")

    # Refused: an auditor cannot edit, and a locked note cannot change.
    assert save(client, as_user("auditor-1"), IN_REVIEW_NOTE).status_code == 403
    assert transition(client, reviewer, LOCKED_NOTE, "APPROVE").status_code == 422
    assert events(db) == []

    # A retried request gets its stored answer and changes nothing again.
    first = save(client, reviewer, IN_REVIEW_NOTE, "save-retry")
    retry = client.post(
        f"/api/notes/{IN_REVIEW_NOTE}/versions",
        json={
            "baseVersionId": first.json()["savedVersion"]["parentVersionId"],
            "clientMutationId": "save-retry",
            "content": content(plan="Event log check."),
        },
        headers=reviewer,
    )
    assert retry.json() == first.json()
    assert len(events(db)) == 1


def test_numbers_follow_the_order_of_changes(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    reviewer = as_user("reviewer-1")
    save(client, reviewer, IN_REVIEW_NOTE, "save-a")
    save(client, reviewer, IN_REVIEW_NOTE, "save-b")
    transition(client, reviewer, IN_REVIEW_NOTE, "APPROVE")

    recorded = events(db)
    cursors = [event.cursor for event in recorded]
    assert cursors == sorted(cursors)
    assert [event.type for event in recorded] == [
        "note.version_added",
        "note.version_added",
        "note.status_changed",
    ]
    assert latest_cursor(db) == cursors[-1]


# --- Catching up ------------------------------------------------------------


def add_event(db: Session, note_id: str, when: datetime | None = None) -> NoteEvent:
    return record_event(
        db,
        note_id=note_id,
        event_type="note.version_added",
        payload={"note": {"id": note_id}},
        occurred_at=when or datetime.now(UTC),
    )


def test_catching_up_returns_the_missed_events_of_those_notes(db: Session) -> None:
    seen = add_event(db, IN_REVIEW_NOTE)
    missed = add_event(db, IN_REVIEW_NOTE)
    add_event(db, READY_NOTE)  # a note the client does not follow
    also_missed = add_event(db, LOCKED_NOTE)

    page = events_after(db, [IN_REVIEW_NOTE, LOCKED_NOTE], after=seen.cursor)

    assert [event["cursor"] for event in page.events] == [
        missed.cursor,
        also_missed.cursor,
    ]
    assert (page.has_more, page.reset_required) == (False, False)
    message = page.events[0]
    assert message == {
        "eventId": missed.event_id,
        "cursor": missed.cursor,
        "noteId": IN_REVIEW_NOTE,
        "occurredAt": message["occurredAt"],
        "type": "note.version_added",
        "response": {"note": {"id": IN_REVIEW_NOTE}},
    }
    assert message["occurredAt"].endswith("Z")


def test_catching_up_comes_in_pages(db: Session) -> None:
    first = add_event(db, IN_REVIEW_NOTE)
    for _ in range(4):
        add_event(db, IN_REVIEW_NOTE)

    page = events_after(db, [IN_REVIEW_NOTE], after=first.cursor - 1, limit=3)
    rest = events_after(db, [IN_REVIEW_NOTE], after=page.events[-1]["cursor"], limit=3)

    assert len(page.events) == 3
    assert page.has_more is True
    assert len(rest.events) == 2
    assert rest.has_more is False


def test_status_changes_carry_their_trigger(db: Session) -> None:
    before = latest_cursor(db)
    record_event(
        db,
        note_id=READY_NOTE,
        event_type="note.status_changed",
        payload={},
        occurred_at=datetime.now(UTC),
        trigger="START_REVIEW",
    )

    [message] = events_after(db, [READY_NOTE], after=before).events

    assert message["trigger"] == "START_REVIEW"


def test_nothing_new_and_no_notes(db: Session) -> None:
    latest = add_event(db, IN_REVIEW_NOTE).cursor

    assert events_after(db, [IN_REVIEW_NOTE], after=latest).events == []
    assert events_after(db, [], after=latest).reset_required is False


def test_a_client_ahead_of_the_log_must_reload(db: Session) -> None:
    # As after the database was reset and numbering started over.
    page = events_after(db, [IN_REVIEW_NOTE], after=latest_cursor(db) + 100)

    assert page.reset_required is True
    assert page.events == []


# --- Pruning ----------------------------------------------------------------


def test_pruning_removes_old_events_and_remembers_how_far(db: Session) -> None:
    now = datetime.now(UTC)
    old = add_event(db, IN_REVIEW_NOTE, now - timedelta(days=40))
    older = add_event(db, READY_NOTE, now - timedelta(days=31))
    recent = add_event(db, IN_REVIEW_NOTE, now - timedelta(days=1))

    removed = prune_events(db, now - timedelta(days=30))

    assert removed == 2
    assert [event.cursor for event in events(db)] == [recent.cursor]
    assert db.scalar(select(NoteEventLogState.pruned_through)) == older.cursor

    # A client that saw only the first event missed one that is gone.
    assert events_after(db, [IN_REVIEW_NOTE], after=old.cursor).reset_required
    # One that saw everything pruned can still catch up.
    page = events_after(db, [IN_REVIEW_NOTE], after=older.cursor)
    assert page.reset_required is False
    assert [event["cursor"] for event in page.events] == [recent.cursor]


def test_pruning_never_moves_the_mark_back(db: Session) -> None:
    now = datetime.now(UTC)
    add_event(db, IN_REVIEW_NOTE, now - timedelta(days=40))
    newest_old = add_event(db, IN_REVIEW_NOTE, now - timedelta(days=35))
    prune_events(db, now - timedelta(days=30))
    db.execute(
        update(NoteEventLogState).values(pruned_through=newest_old.cursor + 1000)
    )
    # A later run that removes an event numbered below the mark.
    add_event(db, IN_REVIEW_NOTE, now - timedelta(days=50))

    prune_events(db, now - timedelta(days=45))

    assert db.scalar(select(NoteEventLogState.pruned_through)) == (
        newest_old.cursor + 1000
    )


def test_pruning_with_nothing_old_changes_nothing(db: Session) -> None:
    add_event(db, IN_REVIEW_NOTE)

    assert prune_events(db, datetime.now(UTC) - timedelta(days=30)) == 0
    assert db.scalar(select(func.count()).select_from(NoteEventLogState)) == 0


@pytest.fixture
def run_prune(monkeypatch: pytest.MonkeyPatch, settings: Settings):
    monkeypatch.setattr(prune_command, "get_settings", lambda: settings)
    return prune_command.main


def test_the_prune_command(run_prune, capsys: pytest.CaptureFixture[str]) -> None:
    assert run_prune(["--days", "30"]) == 0
    assert "Removed 0 events older than 30 days." in capsys.readouterr().out

    assert run_prune(["--days", "0"]) == 1
    assert "at least 1 day" in capsys.readouterr().err
