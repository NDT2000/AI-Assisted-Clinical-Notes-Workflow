"""The clinical-notes-seed command and its safety checks."""

from collections.abc import Iterator

import pytest
from pydantic import SecretStr
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from clinical_notes_api.config import Settings
from clinical_notes_api.db import Note, User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.security import verify_password
from clinical_notes_api.seed import __main__ as seed_command
from clinical_notes_api.seed.load import clear_all


def use_settings(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    monkeypatch.setattr(seed_command, "get_settings", lambda: settings)


@pytest.fixture
def empty_database(engine: Engine) -> Iterator[None]:
    with create_session_factory(engine).begin() as session:
        clear_all(session)
    yield
    with create_session_factory(engine).begin() as session:
        clear_all(session)


def note_count(engine: Engine) -> int:
    with Session(engine) as session:
        return session.scalar(select(func.count()).select_from(Note)) or 0


def test_refuses_to_run_in_production(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    use_settings(
        monkeypatch,
        Settings(
            _env_file=None,
            environment="production",
            # Unreachable: refusing must happen before connecting.
            database_url="postgresql+psycopg://nobody@127.0.0.1:1/none",
            jwt_secret=SecretStr("a-production-secret-that-is-long-enough"),
        ),
    )

    assert seed_command.main(["--count", "5"]) == 1
    assert "Refusing to seed" in capsys.readouterr().err


def test_seeds_then_refuses_to_seed_twice_without_reset(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    engine: Engine,
    test_database_url: str,
    empty_database: None,
) -> None:
    use_settings(
        monkeypatch,
        Settings(
            _env_file=None,
            environment="development",
            database_url=test_database_url,
            demo_user_password=SecretStr("seeded-password"),
        ),
    )

    assert seed_command.main(["--count", "5"]) == 0
    assert "Seeded 5 notes" in capsys.readouterr().out
    assert note_count(engine) == 5
    with Session(engine) as session:
        user = session.get(User, "reviewer-1")
        assert user is not None
        # Demo users get the configured password.
        assert verify_password("seeded-password", user.password_hash)

    assert seed_command.main(["--count", "7"]) == 1
    assert "--reset" in capsys.readouterr().err
    assert note_count(engine) == 5

    assert seed_command.main(["--count", "7", "--reset"]) == 0
    assert note_count(engine) == 7
