"""Accounts: the user model, its database rules, and the create-admin command."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import Engine, delete, insert, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from clinical_notes_api.accounts import create_admin
from clinical_notes_api.accounts.users import (
    AccountError,
    create_user,
    normalize_username,
)
from clinical_notes_api.config import Settings
from clinical_notes_api.db import (
    RefreshToken,
    User,
    UserAdminEvent,
    UserSetupLink,
)
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.security import verify_password
from clinical_notes_api.seed.load import clear_all, seed_database
from tests.conftest import alembic_config

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
STRONG_PASSWORD = "correct horse battery"  # noqa: S105 - test fixture


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """Seeded users (no notes), rolled back after each test."""
    session = create_session_factory(engine)()
    try:
        seed_database(session, count=0, reset=True, password=STRONG_PASSWORD)
        session.flush()
        yield session
    finally:
        session.rollback()
        session.close()


# --- Usernames and passwords ------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "stored"),
    [("Jordan.Lee", "jordan.lee"), ("  dr_brooks  ", "dr_brooks"), ("a-1", "a-1")],
)
def test_usernames_are_trimmed_and_lowercase(raw: str, stored: str) -> None:
    assert normalize_username(raw) == stored


@pytest.mark.parametrize("raw", ["ab", "x" * 33, "jordan lee", "jordan@lee", ""])
def test_bad_usernames_are_refused(raw: str) -> None:
    with pytest.raises(AccountError, match="3 to 32 characters"):
        normalize_username(raw)


def test_create_user_hashes_the_password_and_records_it(db: Session) -> None:
    user = create_user(
        db,
        username="New.Clinician",
        display_name="  Dr. Ada Park ",
        role="CLINICIAN",
        password=STRONG_PASSWORD,
        actor_id="admin-1",
        now=NOW,
    )

    assert user.id.startswith("user-")
    assert user.username == "new.clinician"
    assert user.display_name == "Dr. Ada Park"
    assert user.is_active is True
    assert user.mfa_enabled is False
    assert user.created_by_id == "admin-1"
    assert user.password_hash != STRONG_PASSWORD
    assert verify_password(STRONG_PASSWORD, user.password_hash)

    event = db.scalar(
        select(UserAdminEvent).where(UserAdminEvent.target_user_id == user.id)
    )
    assert event is not None
    assert (event.action, event.actor_id) == ("CREATED", "admin-1")
    assert event.details == {"username": "new.clinician", "role": "CLINICIAN"}


def test_reviewers_and_admins_get_the_second_factor_flag(db: Session) -> None:
    reviewer = create_user(
        db,
        username="new-reviewer",
        display_name="Robin Vale",
        role="REVIEWER",
        password=None,
        actor_id="admin-1",
        now=NOW,
    )

    assert reviewer.mfa_enabled is True
    # No password yet: the user will choose one from a setup link.
    assert reviewer.password_hash is None


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"username": "ADMIN-1"}, "already taken"),
        ({"password": "short"}, "at least 12"),
        ({"display_name": "   "}, "Enter the person's name"),
        ({"role": "PATIENT"}, "not a role"),
    ],
)
def test_create_user_refuses_broken_rules(
    db: Session,
    changes: dict,
    message: str,
) -> None:
    request = {
        "username": "someone-new",
        "display_name": "Someone New",
        "role": "CLINICIAN",
        "password": STRONG_PASSWORD,
        "actor_id": None,
        "now": NOW,
        **changes,
    }

    with pytest.raises(AccountError, match=message):
        create_user(db, **request)


# --- Database rules ---------------------------------------------------------


def test_seeded_users_sign_in_with_their_id(db: Session) -> None:
    users = db.scalars(select(User)).all()

    assert users
    assert all(user.username == user.id for user in users)
    assert all(user.is_active for user in users)


@pytest.mark.parametrize("username", ["Upper-Case", "no spaces", "x"])
def test_database_refuses_malformed_usernames(db: Session, username: str) -> None:
    with pytest.raises(IntegrityError):
        db.execute(
            update(User).where(User.id == "clinician-1").values(username=username)
        )


def test_database_refuses_a_duplicate_username(db: Session) -> None:
    with pytest.raises(IntegrityError):
        db.execute(
            update(User).where(User.id == "clinician-2").values(username="clinician-1")
        )


@pytest.mark.parametrize("model", [UserSetupLink, RefreshToken])
def test_tokens_must_expire_after_they_are_made(db: Session, model) -> None:
    values = {
        "id": "token-1",
        "user_id": "clinician-1",
        "token_hash": "a" * 64,
        "created_at": NOW,
        "expires_at": NOW - timedelta(minutes=1),
    }
    if model is RefreshToken:
        values["family_id"] = "family-1"

    with pytest.raises(IntegrityError):
        db.execute(insert(model).values(**values))


def test_admin_action_log_cannot_be_changed(db: Session) -> None:
    user = create_user(
        db,
        username="audited",
        display_name="Audited User",
        role="CLINICIAN",
        password=None,
        actor_id="admin-1",
        now=NOW,
    )

    for statement in (
        update(UserAdminEvent).values(action="RENAMED"),
        delete(UserAdminEvent).where(UserAdminEvent.target_user_id == user.id),
    ):
        savepoint = db.begin_nested()
        with pytest.raises(DBAPIError, match="immutable"):
            db.execute(statement)
        savepoint.rollback()


def test_migration_gives_existing_users_their_id_as_username(
    engine: Engine,
    test_database_url: str,
) -> None:
    config = alembic_config(test_database_url)
    with create_session_factory(engine).begin() as session:
        clear_all(session)
    command.downgrade(config, "8d3f6b1c2e90")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users (id, display_name, role, mfa_enabled) "
                    "VALUES ('Reviewer-9', 'Old Reviewer', 'REVIEWER', true)"
                )
            )
    finally:
        command.upgrade(config, "head")

    with Session(engine) as session:
        user = session.get(User, "Reviewer-9")
        assert user is not None
        assert user.username == "reviewer-9"
        assert user.is_active is True
        assert user.created_at is not None
    with create_session_factory(engine).begin() as session:
        clear_all(session)


# --- The create-admin command -----------------------------------------------


@pytest.fixture
def run_create_admin(
    monkeypatch: pytest.MonkeyPatch,
    test_database_url: str,
    engine: Engine,
) -> Iterator:
    monkeypatch.setattr(
        create_admin,
        "get_settings",
        lambda: Settings(
            _env_file=None,
            environment="production",
            database_url=test_database_url,
            jwt_secret="a-production-secret-that-is-long-enough",  # noqa: S106
        ),
    )
    with create_session_factory(engine).begin() as session:
        clear_all(session)

    def run(answers: list[str], secrets: list[str], argv: list[str] | None = None):
        answer_queue, secret_queue = list(answers), list(secrets)
        return create_admin.main(
            argv or [],
            ask=lambda _prompt: answer_queue.pop(0),
            ask_secret=lambda _prompt: secret_queue.pop(0),
        )

    yield run
    with create_session_factory(engine).begin() as session:
        clear_all(session)


def admins(engine: Engine) -> list[User]:
    with Session(engine) as session:
        return list(session.scalars(select(User).where(User.role == "ADMIN")))


def test_create_admin_makes_an_administrator_in_production(
    run_create_admin,
    engine: Engine,
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = run_create_admin(
        ["Head.Admin", "Sam Okafor"],
        [STRONG_PASSWORD, STRONG_PASSWORD],
    )

    assert code == 0
    assert "Created administrator head.admin" in capsys.readouterr().out
    [admin] = admins(engine)
    assert admin.username == "head.admin"
    assert admin.display_name == "Sam Okafor"
    assert admin.mfa_enabled is True
    assert verify_password(STRONG_PASSWORD, admin.password_hash)
    with Session(engine) as session:
        event = session.scalar(select(UserAdminEvent))
        assert event is not None
        # Made by the command, not by a signed-in admin.
        assert (event.action, event.actor_id) == ("CREATED", None)


def test_create_admin_accepts_names_as_arguments(run_create_admin, engine) -> None:
    code = run_create_admin(
        [],
        [STRONG_PASSWORD, STRONG_PASSWORD],
        ["--username", "ops-admin", "--name", "Ops Admin"],
    )

    assert code == 0
    assert [admin.username for admin in admins(engine)] == ["ops-admin"]


@pytest.mark.parametrize(
    ("answers", "secrets", "message"),
    [
        (
            ["ok-admin", "Ok Admin"],
            [STRONG_PASSWORD, "something else entirely"],
            "match",
        ),
        (["ok-admin", "Ok Admin"], ["short", "short"], "at least 12"),
        # A bad username fails before any password is asked for.
        (["no spaces allowed", "Ok Admin"], [], "3 to 32 characters"),
    ],
)
def test_create_admin_refuses_bad_input(
    run_create_admin,
    engine: Engine,
    capsys: pytest.CaptureFixture[str],
    answers: list[str],
    secrets: list[str],
    message: str,
) -> None:
    assert run_create_admin(answers, secrets) == 1
    assert message in capsys.readouterr().err
    assert admins(engine) == []


def test_create_admin_refuses_a_taken_username(
    run_create_admin,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert run_create_admin(["taken", "First"], [STRONG_PASSWORD] * 2) == 0

    assert run_create_admin(["TAKEN", "Second"], [STRONG_PASSWORD] * 2) == 1
    assert "already taken" in capsys.readouterr().err
