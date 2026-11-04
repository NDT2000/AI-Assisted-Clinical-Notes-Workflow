"""Login, access tokens and the signed-in user, against a real database."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, delete, text

from clinical_notes_api.config import DEVELOPMENT_JWT_SECRET, Settings
from clinical_notes_api.db import User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.dependencies import get_current_user
from clinical_notes_api.errors import ensure_allowed, forbidden
from clinical_notes_api.main import create_app
from clinical_notes_api.security import ALGORITHM, ISSUER, create_access_token
from clinical_notes_api.seed.load import seed_database
from clinical_notes_api.workflow import Decision

PASSWORD = "test-password"  # noqa: S105 - test fixture


@pytest.fixture(scope="module")
def settings(test_database_url: str) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_url=test_database_url,
        jwt_secret=SecretStr("test-secret-that-is-long-enough-for-hs256"),
        access_token_minutes=15,
    )


@pytest.fixture(scope="module")
def seeded_users(engine: Engine) -> Iterator[None]:
    with create_session_factory(engine).begin() as session:
        seed_database(session, count=0, reset=True, demo_password=PASSWORD)
    yield
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))


@pytest.fixture
def app(settings: Settings, seeded_users: None) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def login(client: TestClient, username: str, password: str = PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_login_returns_a_token_and_the_user(client: TestClient) -> None:
    response = login(client, "reviewer-1")

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"  # noqa: S105 - token type
    assert body["expires_in"] == 15 * 60
    assert body["user"] == {
        "id": "reviewer-1",
        "display_name": "Alex Kim",
        "role": "REVIEWER",
        "mfa_verified": True,
    }


@pytest.mark.parametrize(
    ("username", "password"),
    [("reviewer-1", "wrong-password"), ("nobody", PASSWORD)],
    ids=["wrong password", "unknown user"],
)
def test_bad_credentials_get_the_same_answer(
    client: TestClient,
    username: str,
    password: str,
) -> None:
    response = login(client, username, password)

    assert response.status_code == 401
    assert response.json() == {
        "error": "unauthenticated",
        "message": "The username or password is incorrect.",
    }
    assert response.headers["www-authenticate"] == "Bearer"


def test_me_returns_the_signed_in_user(client: TestClient) -> None:
    token = login(client, "clinician-1").json()["access_token"]

    response = client.get("/api/auth/me", headers=bearer(token))

    assert response.status_code == 200
    assert response.json()["role"] == "CLINICIAN"
    assert response.json()["mfa_verified"] is False


def test_me_requires_a_token(client: TestClient) -> None:
    response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["error"] == "unauthenticated"


def test_expired_token_is_rejected(client: TestClient, settings: Settings) -> None:
    token, _ = create_access_token(
        user_id="reviewer-1",
        role="REVIEWER",
        mfa_verified=True,
        settings=settings,
        now=datetime.now(UTC) - timedelta(hours=2),
    )

    response = client.get("/api/auth/me", headers=bearer(token))

    assert response.status_code == 401


def test_token_signed_with_another_key_is_rejected(client: TestClient) -> None:
    forged = jwt.encode(
        {
            "iss": ISSUER,
            "sub": "admin-1",
            "role": "ADMIN",
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        "a-different-secret-that-is-long-enough",
        algorithm=ALGORITHM,
    )

    response = client.get("/api/auth/me", headers=bearer(forged))

    assert response.status_code == 401


def test_removed_user_loses_access_at_once(
    client: TestClient,
    engine: Engine,
) -> None:
    token = login(client, "auditor-1").json()["access_token"]

    with create_session_factory(engine).begin() as session:
        session.execute(delete(User).where(User.id == "auditor-1"))

    try:
        response = client.get("/api/auth/me", headers=bearer(token))
        assert response.status_code == 401
    finally:
        with create_session_factory(engine).begin() as session:
            session.add(
                User(
                    id="auditor-1",
                    display_name="Taylor Morgan",
                    role="READONLY_AUDITOR",
                )
            )


def test_role_comes_from_the_database_not_the_token(
    client: TestClient,
    settings: Settings,
) -> None:
    # A token that claims ADMIN for a clinician must not grant ADMIN.
    token, _ = create_access_token(
        user_id="clinician-1",
        role="ADMIN",
        mfa_verified=True,
        settings=settings,
    )

    response = client.get("/api/auth/me", headers=bearer(token))

    assert response.json()["role"] == "CLINICIAN"
    assert response.json()["mfa_verified"] is False


def test_ensure_allowed_uses_the_workflow_reason() -> None:
    ensure_allowed(Decision(allowed=True, next_status="IN_REVIEW"))

    with pytest.raises(type(forbidden(""))) as raised:
        ensure_allowed(Decision(allowed=False, reason="Only a Reviewer can approve."))

    assert raised.value.status_code == 403
    assert raised.value.code == "forbidden"
    assert raised.value.message == "Only a Reviewer can approve."


def _depends_on(route: APIRoute, dependency: object) -> bool:
    pending = list(route.dependant.dependencies)
    while pending:
        current = pending.pop()
        if current.call is dependency:
            return True
        pending.extend(current.dependencies)
    return False


PUBLIC_MUTATIONS = {("POST", "/api/auth/login")}


def test_every_mutation_requires_a_signed_in_user(app: FastAPI) -> None:
    unprotected = [
        f"{method} {route.path}"
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods - {"GET", "HEAD", "OPTIONS"}
        if (method, route.path) not in PUBLIC_MUTATIONS
        and not _depends_on(route, get_current_user)
    ]

    assert unprotected == []


def test_production_requires_a_real_jwt_secret() -> None:
    with pytest.raises(ValueError, match="Set JWT_SECRET"):
        Settings(
            _env_file=None,
            environment="production",
            jwt_secret=SecretStr(DEVELOPMENT_JWT_SECRET),
        )

    with pytest.raises(ValueError, match="at least 32"):
        Settings(
            _env_file=None, environment="production", jwt_secret=SecretStr("short")
        )

    Settings(
        _env_file=None,
        environment="production",
        jwt_secret=SecretStr("a-production-secret-that-is-long-enough"),
    )
