from fastapi.testclient import TestClient

from clinical_notes_api.config import Settings
from clinical_notes_api.main import create_app


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
