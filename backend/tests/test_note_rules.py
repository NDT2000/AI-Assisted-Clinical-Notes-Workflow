"""The endpoints apply the workflow rules to real notes and users.

test_workflow_contract.py checks the rules themselves against every case in
the shared contract. These tests check the wiring: for every note status,
every kind of user and every action, the API's answer is exactly what the
rules decide for that note's stored state (status, reviewer, approval time,
content) and that user's stored role and MFA flag.

Each attempt runs inside a savepoint that is rolled back, so every one
starts from the same seeded note.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Connection, select, update
from sqlalchemy.orm import Session

from clinical_notes_api.db import Note, NoteVersion, User
from clinical_notes_api.db.models import NOTE_STATUSES
from clinical_notes_api.notes.schemas import UserTrigger
from clinical_notes_api.workflow import (
    Actor,
    Decision,
    NoteState,
    SoapContent,
    can_assign_reviewer,
    can_edit_note_content,
    can_manage_reviewer_assignments,
    can_request_regeneration,
    can_transition,
)
from tests.note_api import content

USER_TRIGGERS: tuple[str, ...] = UserTrigger.__args__  # type: ignore[attr-defined]

# One user of each kind. "assigned" and "other reviewer" are worked out per
# note, since they depend on who the note's reviewer is. The assigned
# reviewer is tried twice: with MFA (as seeded) and without it.
FIXED_USERS = ("clinician-1", "admin-1", "auditor-1")


@contextmanager
def rolled_back(connection: Connection) -> Iterator[None]:
    savepoint = connection.begin_nested()
    try:
        yield
    finally:
        savepoint.rollback()


def note_in_status(db: Session, status: str) -> Note:
    note = db.scalar(select(Note).where(Note.status == status).order_by(Note.id))
    assert note is not None, f"the seed has no {status} note"
    return note


def users_for(note: Note) -> list[tuple[str, bool]]:
    """(user id, whether to switch their MFA off first)."""
    assigned = note.assigned_reviewer_id or "reviewer-1"
    other = "reviewer-2" if assigned != "reviewer-2" else "reviewer-3"
    return [
        *((user_id, False) for user_id in FIXED_USERS),
        (assigned, False),
        (assigned, True),
        (other, False),
    ]


def expected_rules(db: Session, note: Note, user_id: str):
    user = db.get(User, user_id)
    version = db.get(NoteVersion, note.current_version_id)
    assert user is not None and version is not None
    actor = Actor(id=user.id, role=user.role, mfa_verified=user.mfa_enabled)
    state = NoteState(
        status=note.status,
        assigned_reviewer_id=note.assigned_reviewer_id,
        approved_at=note.approved_at,
    )
    soap = SoapContent(
        subjective=version.subjective,
        objective=version.objective,
        assessment=version.assessment,
        plan=version.plan,
    )
    return actor, state, soap


def check_answer(
    response,
    decision: Decision,
    allowed_status: int,
    denied_status: int,
    case: str,
) -> None:
    if decision.allowed:
        assert response.status_code == allowed_status, (case, response.json())
    else:
        assert response.status_code == denied_status, (case, response.json())
        assert response.json()["message"] == decision.reason, case


@pytest.fixture
def check_every_user(
    db: Session,
    connection: Connection,
) -> Callable[[Note, Callable[[str], None]], None]:
    """Run `attempt(user_id)` for each kind of user, each from a clean note."""

    def run(note: Note, attempt: Callable[[str], None]) -> None:
        for user_id, mfa_off in users_for(note):
            with rolled_back(connection):
                if mfa_off:
                    connection.execute(
                        update(User).where(User.id == user_id).values(mfa_enabled=False)
                    )
                db.expire_all()
                attempt(user_id)
            db.expire_all()

    return run


@pytest.mark.parametrize("status", NOTE_STATUSES)
@pytest.mark.parametrize("trigger", USER_TRIGGERS)
def test_transitions_follow_the_rules(
    client: TestClient,
    as_user,
    db: Session,
    check_every_user,
    status: str,
    trigger: str,
) -> None:
    note = note_in_status(db, status)

    def attempt(user_id: str) -> None:
        actor, state, soap = expected_rules(db, note, user_id)
        now = datetime.now(UTC)
        decision = can_transition(
            state, trigger, actor, soap, now, rejection_reason="Needs changes."
        )

        response = client.post(
            f"/api/notes/{note.id}/transitions",
            json={
                "baseVersionId": note.current_version_id,
                "clientMutationId": f"{trigger}-{user_id}",
                "trigger": trigger,
                "rejectionReason": "Needs changes.",
            },
            headers=as_user(user_id),
        )

        check_answer(response, decision, 200, 422, f"{trigger} {status} {user_id}")
        if decision.allowed:
            assert response.json()["note"]["status"] == decision.next_status

    check_every_user(note, attempt)


def test_amend_is_allowed_within_a_day_of_approval(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    note = note_in_status(db, "APPROVED")
    db.execute(
        update(Note)
        .where(Note.id == note.id)
        .values(approved_at=datetime.now(UTC) - timedelta(hours=23))
    )
    db.commit()

    response = client.post(
        f"/api/notes/{note.id}/transitions",
        json={
            "baseVersionId": note.current_version_id,
            "clientMutationId": "amend-in-time",
            "trigger": "AMEND",
        },
        headers=as_user("clinician-1"),
    )

    assert response.status_code == 200
    assert response.json()["note"]["status"] == "AMENDED"


def test_resubmit_requires_complete_content(
    client: TestClient,
    as_user,
    db: Session,
) -> None:
    note = note_in_status(db, "REJECTED")
    headers = as_user("clinician-1")
    saved = client.post(
        f"/api/notes/{note.id}/versions",
        json={
            "baseVersionId": note.current_version_id,
            "clientMutationId": "blank-plan",
            "content": content(plan="   "),
        },
        headers=headers,
    ).json()["savedVersion"]

    response = client.post(
        f"/api/notes/{note.id}/transitions",
        json={
            "baseVersionId": saved["versionId"],
            "clientMutationId": "resubmit-incomplete",
            "trigger": "RESUBMIT",
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["error"] == "transition_not_allowed"


@pytest.mark.parametrize("status", NOTE_STATUSES)
def test_saving_follows_the_editing_rules(
    client: TestClient,
    as_user,
    db: Session,
    check_every_user,
    status: str,
) -> None:
    note = note_in_status(db, status)

    def attempt(user_id: str) -> None:
        actor, state, _ = expected_rules(db, note, user_id)
        decision = can_edit_note_content(state, actor)

        response = client.post(
            f"/api/notes/{note.id}/versions",
            json={
                "baseVersionId": note.current_version_id,
                "clientMutationId": f"edit-{user_id}",
                "content": content(),
            },
            headers=as_user(user_id),
        )

        check_answer(response, decision, 201, 403, f"edit {status} {user_id}")

    check_every_user(note, attempt)


@pytest.mark.parametrize("status", NOTE_STATUSES)
def test_bulk_assignment_follows_the_rules(
    client: TestClient,
    as_user,
    db: Session,
    check_every_user,
    status: str,
) -> None:
    note = note_in_status(db, status)

    def attempt(user_id: str) -> None:
        role = db.get(User, user_id).role
        response = client.post(
            "/api/notes/bulk/assign-reviewer",
            json={"noteIds": [note.id], "reviewerId": "reviewer-4"},
            headers=as_user(user_id),
        )

        role_decision = can_manage_reviewer_assignments(role)
        if not role_decision.allowed:
            assert response.status_code == 403
            assert response.json()["message"] == role_decision.reason
            return

        assigned = can_assign_reviewer(status, role).allowed
        assert response.json() == {"updated": [note.id] if assigned else []}

    check_every_user(note, attempt)


@pytest.mark.parametrize("status", NOTE_STATUSES)
def test_bulk_regeneration_follows_the_rules(
    client: TestClient,
    as_user,
    db: Session,
    check_every_user,
    status: str,
) -> None:
    note = note_in_status(db, status)

    def attempt(user_id: str) -> None:
        role = db.get(User, user_id).role
        response = client.post(
            "/api/notes/bulk/regenerate",
            json={"noteIds": [note.id]},
            headers=as_user(user_id),
        )

        role_decision = can_request_regeneration("FAILED", role)
        if not role_decision.allowed:
            assert response.status_code == 403
            assert response.json()["message"] == role_decision.reason
            return

        regenerated = can_request_regeneration(status, role).allowed
        assert response.json() == {
            "updated": [note.id] if regenerated else [],
            "skipped": [] if regenerated else [note.id],
        }

    check_every_user(note, attempt)


def test_the_matrix_exercises_both_outcomes(db: Session) -> None:
    """Guard against a matrix that only ever sees refusals (or approvals)."""
    outcomes = set()
    for status in NOTE_STATUSES:
        note = note_in_status(db, status)
        for user_id, _ in users_for(note):
            actor, state, soap = expected_rules(db, note, user_id)
            for trigger in USER_TRIGGERS:
                decision = can_transition(
                    state,
                    trigger,
                    actor,
                    soap,
                    datetime.now(UTC),
                    rejection_reason="Needs changes.",
                )
                outcomes.add((trigger, decision.allowed))

    allowed_triggers = {trigger for trigger, allowed in outcomes if allowed}
    # AMEND is only allowed within a day of approval; its own test covers it.
    assert allowed_triggers == set(USER_TRIGGERS) - {"AMEND"}
