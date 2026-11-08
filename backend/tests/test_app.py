"""The application itself: settings, the health endpoint and CORS."""

import pytest
from fastapi.testclient import TestClient

from clinical_notes_api.config import Settings
from clinical_notes_api.main import create_app


def test_environment_variables_override_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql+psycopg://user:secret@db:5432/notes",
    )
    monkeypatch.setenv("CORS_ORIGINS", '["https://notes.example.com"]')
    monkeypatch.setenv("JWT_SECRET", "a-production-secret-that-is-long-enough")
    monkeypatch.setenv("ACCESS_TOKEN_MINUTES", "30")

    settings = Settings(_env_file=None)

    assert settings.environment == "production"
    assert settings.database_url == "postgresql+psycopg://user:secret@db:5432/notes"
    assert settings.cors_origins == ["https://notes.example.com"]
    assert (
        settings.jwt_secret.get_secret_value()
        == "a-production-secret-that-is-long-enough"
    )
    assert settings.access_token_minutes == 30


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


def test_health_reports_ok_and_environment() -> None:
    client = TestClient(create_app(Settings(environment="test")))

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "environment": "test"}


def test_cors_allows_the_configured_frontend_origin() -> None:
    client = TestClient(
        create_app(Settings(cors_origins=["http://localhost:5173"])),
    )

    response = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_other_origins() -> None:
    client = TestClient(
        create_app(Settings(cors_origins=["http://localhost:5173"])),
    )

    response = client.get(
        "/api/health",
        headers={"Origin": "https://example.com"},
    )

    assert "access-control-allow-origin" not in response.headers
