import pytest

from clinical_notes_api.config import Settings


def test_environment_variables_override_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://user:secret@db:5432/notes",
    )
    monkeypatch.setenv("CORS_ORIGINS", '["https://notes.example.com"]')

    settings = Settings(_env_file=None)

    assert settings.environment == "production"
    assert settings.database_url == "postgresql+psycopg://user:secret@db:5432/notes"
    assert settings.cors_origins == ["https://notes.example.com"]


def test_defaults_point_at_the_local_compose_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("ENVIRONMENT", "DATABASE_URL", "CORS_ORIGINS"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert settings.database_url.endswith("@localhost:5433/clinical_notes")
    assert settings.cors_origins == ["http://localhost:5173"]


def test_unknown_environment_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "staging")

    with pytest.raises(ValueError):
        Settings(_env_file=None)
