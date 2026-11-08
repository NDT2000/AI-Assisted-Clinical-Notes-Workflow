"""Simultaneous requests for the same note, with real commits.

Every change to a note locks its row first, so requests for one note run
one after the other. Without that lock, two saves from the same version
would both try to write the next revision (one would fail with a database
error), and retries of one request could each make a change.

Unlike the other API tests, these commit: the requests run on separate
database connections, as in production. The module's seeded notes are
cleared afterwards.
"""

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select, update
from sqlalchemy.orm import Session

from clinical_notes_api.accounts import admin
from clinical_notes_api.accounts.users import create_user
from clinical_notes_api.config import Settings
from clinical_notes_api.db import ClientMutation, Note, NoteVersion, ReviewEvent, User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.errors import ApiError
from clinical_notes_api.main import create_app
from tests.note_api import PASSWORD, content

PARALLEL = 8

# The test client's response type (its HTTP library is an internal detail).
Response = Any


@pytest.fixture(scope="module")
def live_app(settings: Settings, seeded_notes: None) -> FastAPI:
    """The app with its own connection pool to the test database."""
    return create_app(settings)


def all_at_once(
    app: FastAPI,
    requests: list[Callable[[TestClient], Response]],
) -> list[Response]:
    """Send the requests from separate threads, released together."""
    start = Barrier(len(requests))

    def run(request: Callable[[TestClient], Response]) -> Response:
        client = TestClient(app)
        start.wait()
        return request(client)

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        return list(pool.map(run, requests))


def first_note(engine: Engine, status: str) -> Note:
    with Session(engine) as session:
        note = session.scalar(
            select(Note).where(Note.status == status).order_by(Note.id)
        )
        assert note is not None
        session.expunge(note)
        return note


def count(engine: Engine, statement) -> int:
    with Session(engine) as session:
        return session.scalar(statement) or 0


def versions_of(engine: Engine, note_id: str) -> int:
    return count(
        engine,
        select(func.count())
        .select_from(NoteVersion)
        .where(NoteVersion.note_id == note_id),
    )


def test_one_of_many_saves_from_the_same_version_wins(
    live_app: FastAPI,
    engine: Engine,
    as_user,
) -> None:
    note = first_note(engine, "REJECTED")
    before = versions_of(engine, note.id)
    headers = as_user("clinician-1")

    def save(index: int) -> Callable[[TestClient], Response]:
        return lambda client: client.post(
            f"/api/notes/{note.id}/versions",
            json={
                "baseVersionId": note.current_version_id,
                "clientMutationId": f"race-{index}",
                "content": content(plan=f"Plan from writer {index}."),
            },
            headers=headers,
        )

    responses = all_at_once(live_app, [save(i) for i in range(PARALLEL)])

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [201] + [409] * (PARALLEL - 1)
    winner = next(r for r in responses if r.status_code == 201).json()
    for response in responses:
        if response.status_code == 409:
            body = response.json()
            assert body["error"] == "version_conflict"
            assert body["currentVersion"] == winner["savedVersion"]
    assert versions_of(engine, note.id) == before + 1


def test_simultaneous_retries_make_one_change(
    live_app: FastAPI,
    engine: Engine,
    as_user,
) -> None:
    note = first_note(engine, "AMENDED")
    before = versions_of(engine, note.id)
    headers = as_user("clinician-2")
    body = {
        "baseVersionId": note.current_version_id,
        "clientMutationId": "retried-save",
        "content": content(),
    }

    def save(client: TestClient) -> Response:
        return client.post(f"/api/notes/{note.id}/versions", json=body, headers=headers)

    responses = all_at_once(live_app, [save] * PARALLEL)

    assert {response.status_code for response in responses} == {201}
    assert len({response.text for response in responses}) == 1
    assert versions_of(engine, note.id) == before + 1
    assert (
        count(
            engine,
            select(func.count())
            .select_from(ClientMutation)
            .where(ClientMutation.note_id == note.id),
        )
        == 1
    )


def test_only_one_reviewer_can_start_a_review(
    live_app: FastAPI,
    engine: Engine,
    as_user,
) -> None:
    note = first_note(engine, "READY_FOR_REVIEW")
    with Session(engine) as session, session.begin():
        # Unassigned, so every reviewer may start it, but only one can.
        session.execute(
            update(Note).where(Note.id == note.id).values(assigned_reviewer_id=None)
        )
    reviewers = [f"reviewer-{n}" for n in range(1, 6)]

    def start(reviewer: str) -> Callable[[TestClient], Response]:
        return lambda client: client.post(
            f"/api/notes/{note.id}/transitions",
            json={
                "baseVersionId": note.current_version_id,
                "clientMutationId": f"start-{reviewer}",
                "trigger": "START_REVIEW",
            },
            headers=as_user(reviewer),
        )

    responses = all_at_once(live_app, [start(r) for r in reviewers])

    statuses = sorted(response.status_code for response in responses)
    assert statuses == [200] + [422] * (len(reviewers) - 1)
    winner = next(r for r in responses if r.status_code == 200).json()
    with Session(engine) as session:
        stored = session.get(Note, note.id)
        assert stored is not None
        assert stored.status == "IN_REVIEW"
        assert stored.assigned_reviewer_id == winner["note"]["assignedReviewerId"]
        started = session.scalar(
            select(func.count())
            .select_from(ReviewEvent)
            .where(ReviewEvent.note_id == note.id, ReviewEvent.to_status == "IN_REVIEW")
        )
    # A ready note's seeded history has no review start; exactly one was added.
    assert started == 1


def test_overlapping_bulk_actions_do_not_deadlock(
    live_app: FastAPI,
    engine: Engine,
    as_user,
) -> None:
    with Session(engine) as session:
        failed = list(
            session.scalars(
                select(Note.id).where(Note.status == "FAILED").order_by(Note.id)
            )
        )
    assert len(failed) >= 3
    headers = as_user("admin-1")

    def regenerate(note_ids: list[str]) -> Callable[[TestClient], Response]:
        return lambda client: client.post(
            "/api/notes/bulk/regenerate",
            json={"noteIds": note_ids},
            headers=headers,
        )

    # The same notes in opposite orders: locking in request order could
    # deadlock; the API locks in id order.
    responses = all_at_once(
        live_app,
        [regenerate(failed), regenerate(list(reversed(failed)))] * 2,
    )

    assert {response.status_code for response in responses} == {200}
    updated = [i for r in responses for i in r.json()["updated"]]
    assert sorted(updated) == failed


# --- Administrators --------------------------------------------------------


@pytest.fixture
def second_admin(engine: Engine, seeded_notes: None) -> str:
    """A second administrator who can sign in, committed for real.

    Left in place: the module's seeded data is cleared afterwards.
    """
    with create_session_factory(engine).begin() as session:
        user = create_user(
            session,
            username="admin-2",
            display_name="Second Admin",
            role="ADMIN",
            password=PASSWORD,
            actor_id=None,
            now=datetime.now(UTC),
        )
        return user.id


def test_two_admins_cannot_both_be_removed(engine: Engine, second_admin: str) -> None:
    """Two administrators removing each other at the same moment.

    Without the lock on the administrators, both would succeed and leave no
    administrator at all.
    """
    factory = create_session_factory(engine)
    now = datetime.now(UTC)
    second_id = second_admin
    outcome: list[object] = []

    first = factory()
    try:
        actor = first.get(User, "admin-1")
        admin.deactivate(
            first,
            actor=actor,
            user_id=second_id,
            confirm_open_reviews=False,
            now=now,
        )

        def demote_the_first() -> None:
            with factory() as session:
                try:
                    with session.begin():
                        admin.update(
                            session,
                            actor=session.get(User, second_id),
                            user_id="admin-1",
                            username=None,
                            display_name=None,
                            role="CLINICIAN",
                            now=now,
                        )
                    outcome.append("changed")
                except ApiError as error:
                    outcome.append(error.code)

        waiting = threading.Thread(target=demote_the_first)
        waiting.start()
        waiting.join(timeout=0.5)
        assert waiting.is_alive(), "the second change did not wait for the first"
        first.commit()
        waiting.join(timeout=10)
    finally:
        first.close()

    assert outcome == ["last_admin"]
    with Session(engine) as session:
        remaining = session.scalars(
            select(User.id).where(User.role == "ADMIN", User.is_active.is_(True))
        ).all()
    assert remaining == ["admin-1"]
