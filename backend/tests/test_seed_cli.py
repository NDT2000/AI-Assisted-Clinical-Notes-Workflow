"""The clinical-notes-seed command and its safety checks."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from clinical_notes_api.config import REPOSITORY_ROOT, Settings
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


def test_refuses_reset_and_if_empty_together(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit):
        seed_command.main(["--reset", "--if-empty"])
    assert "not allowed with" in capsys.readouterr().err


def dev_settings(test_database_url: str) -> Settings:
    return Settings(
        _env_file=None,
        environment="development",
        database_url=test_database_url,
    )


def read_credentials(path: Path) -> dict[str, str]:
    """username -> password, from the table in the credentials file."""
    rows = [
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.startswith("| `")
    ]
    return {
        row.split("|")[1].strip(" `"): row.split("|")[4].strip(" `") for row in rows
    }


def test_seeds_then_refuses_to_seed_twice_without_reset(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    engine: Engine,
    test_database_url: str,
    empty_database: None,
    tmp_path: Path,
) -> None:
    use_settings(monkeypatch, dev_settings(test_database_url))
    credentials_file = tmp_path / "credentials.local.md"

    assert (
        seed_command.main(["--count", "5", "--credentials-file", str(credentials_file)])
        == 0
    )
    output = capsys.readouterr().out
    assert "Seeded 5 notes" in output
    assert "Passwords written to" in output
    assert note_count(engine) == 5

    assert (
        seed_command.main(["--count", "7", "--credentials-file", str(credentials_file)])
        == 1
    )
    assert "--reset" in capsys.readouterr().err
    assert note_count(engine) == 5

    assert (
        seed_command.main(
            ["--count", "7", "--reset", "--credentials-file", str(credentials_file)]
        )
        == 0
    )
    assert note_count(engine) == 7


def test_every_user_gets_a_password_that_signs_in(
    monkeypatch: pytest.MonkeyPatch,
    engine: Engine,
    test_database_url: str,
    empty_database: None,
    tmp_path: Path,
) -> None:
    use_settings(monkeypatch, dev_settings(test_database_url))
    credentials_file = tmp_path / "credentials.local.md"

    assert (
        seed_command.main(["--count", "0", "--credentials-file", str(credentials_file)])
        == 0
    )

    passwords = read_credentials(credentials_file)
    with Session(engine) as session:
        users = {user.username: user for user in session.scalars(select(User))}
    assert set(passwords) == set(users)
    assert len(set(passwords.values())) == len(passwords), "passwords repeat"
    for username, password in passwords.items():
        assert len(password) >= 20
        assert verify_password(password, users[username].password_hash), username

    # The administrator is listed first, and the file warns against sharing.
    text = credentials_file.read_text(encoding="utf-8")
    first_row = next(line for line in text.splitlines() if line.startswith("| `"))
    assert first_row.startswith("| `admin-1` | Jordan Lee | Administrator |")
    assert "Never commit or share this file" in text


def test_seeding_again_replaces_every_password(
    monkeypatch: pytest.MonkeyPatch,
    test_database_url: str,
    empty_database: None,
    tmp_path: Path,
) -> None:
    use_settings(monkeypatch, dev_settings(test_database_url))
    credentials_file = tmp_path / "credentials.local.md"

    seed_command.main(["--count", "0", "--credentials-file", str(credentials_file)])
    first = read_credentials(credentials_file)
    seed_command.main(
        ["--count", "0", "--reset", "--credentials-file", str(credentials_file)]
    )
    second = read_credentials(credentials_file)

    assert first.keys() == second.keys()
    assert all(first[user] != second[user] for user in first)


def test_nothing_is_seeded_if_the_passwords_cannot_be_written(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    engine: Engine,
    test_database_url: str,
    empty_database: None,
    tmp_path: Path,
) -> None:
    use_settings(monkeypatch, dev_settings(test_database_url))
    unwritable = tmp_path / "missing-folder" / "credentials.local.md"

    assert (
        seed_command.main(["--count", "5", "--credentials-file", str(unwritable)]) == 1
    )

    assert "Nothing was seeded" in capsys.readouterr().err
    assert note_count(engine) == 0
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(User)) == 0


def test_credentials_file_is_git_ignored() -> None:
    ignored = (REPOSITORY_ROOT / ".gitignore").read_text(encoding="utf-8")

    assert "credentials.local.md" in ignored.splitlines()


def test_seeds_in_demo_mode_only_an_empty_database(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    engine: Engine,
    test_database_url: str,
    empty_database: None,
    tmp_path: Path,
) -> None:
    """Compose runs `--if-empty` on every start: first time it seeds, later
    it leaves the data and the passwords alone, and still succeeds."""
    use_settings(
        monkeypatch,
        Settings(
            _env_file=None,
            environment="demo",
            database_url=test_database_url,
            jwt_secret=SecretStr("a-demo-secret-that-is-long-enough-to-pass"),
        ),
    )
    credentials_file = tmp_path / "credentials.local.md"
    arguments = ["--count", "5", "--if-empty", "--credentials-file"]

    assert seed_command.main([*arguments, str(credentials_file)]) == 0
    assert "Seeded 5 notes" in capsys.readouterr().out
    first_passwords = read_credentials(credentials_file)

    assert seed_command.main([*arguments, str(credentials_file)]) == 0
    output = capsys.readouterr().out
    assert "already has notes" in output
    assert "existing passwords still apply" in output
    assert note_count(engine) == 5
    assert read_credentials(credentials_file) == first_passwords
