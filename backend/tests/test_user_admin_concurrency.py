"""Two administrators removing each other at the same moment.

With real commits on separate connections: without the lock on the
administrators, both would succeed and leave no administrator at all.
"""

import threading
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from clinical_notes_api.accounts import admin
from clinical_notes_api.accounts.users import create_user
from clinical_notes_api.db import User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.errors import ApiError
from clinical_notes_api.seed.load import clear_all, seed_database

PASSWORD = "a password for two admins"  # noqa: S105 - test fixture


@pytest.fixture
def two_admins(engine: Engine) -> Iterator[None]:
    with create_session_factory(engine).begin() as session:
        seed_database(session, count=0, reset=True, password=PASSWORD)
        create_user(
            session,
            username="admin-2",
            display_name="Second Admin",
            role="ADMIN",
            password=PASSWORD,
            actor_id=None,
            now=datetime.now(UTC),
        )
    yield
    with create_session_factory(engine).begin() as session:
        clear_all(session)


def test_two_admins_cannot_both_be_removed(engine: Engine, two_admins: None) -> None:
    factory = create_session_factory(engine)
    now = datetime.now(UTC)
    with Session(engine) as session:
        second_id = session.scalar(select(User.id).where(User.username == "admin-2"))
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
