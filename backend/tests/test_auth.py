"""Signing in, sessions and the signed-in user, against a real database.

Covers login, access tokens, the renewal cookie, signing out and the
failed-sign-in lockouts. These requests commit for real (failed attempts and
revoked sessions must survive a refused request), so each test cleans up
after itself.
"""

import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine, delete, func, select, text, update
from sqlalchemy.orm import Session

from clinical_notes_api.accounts import sessions
from clinical_notes_api.accounts.users import create_user
from clinical_notes_api.auth import RENEWAL_COOKIE
from clinical_notes_api.config import DEVELOPMENT_JWT_SECRET, Settings
from clinical_notes_api.db import LoginAttempt, RefreshToken, User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.dependencies import get_current_user
from clinical_notes_api.errors import ApiError, ensure_allowed, forbidden
from clinical_notes_api.main import create_app
from clinical_notes_api.security import (
    ALGORITHM,
    ISSUER,
    create_access_token,
    hash_password,
)
from clinical_notes_api.seed.load import seed_database
from clinical_notes_api.workflow import Decision

# The test client's response type (its HTTP library is not imported here).
Response = Any

FAILURE_LIMIT = 3
IP_FAILURE_LIMIT = 6

PASSWORD = "test-password"  # noqa: S105 - test fixture


@pytest.fixture(scope="module")
def settings(test_database_url: str) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_url=test_database_url,
        jwt_secret=SecretStr("test-secret-that-is-long-enough-for-hs256"),
        access_token_minutes=15,
        login_failure_limit=FAILURE_LIMIT,
        login_ip_failure_limit=IP_FAILURE_LIMIT,
    )


@pytest.fixture(scope="module")
def seeded_users(engine: Engine) -> Iterator[None]:
    with create_session_factory(engine).begin() as session:
        seed_database(session, count=0, reset=True, password=PASSWORD)
    yield
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE users CASCADE"))


@pytest.fixture(autouse=True)
def clean_sessions(engine: Engine, seeded_users: None) -> Iterator[None]:
    yield
    with create_session_factory(engine).begin() as session:
        session.execute(delete(LoginAttempt))
        session.execute(delete(RefreshToken))
        session.execute(update(User).values(is_active=True))


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """For reading and changing what the API committed."""
    with create_session_factory(engine).begin() as session:
        yield session


def login(
    client: TestClient,
    username: str,
    password: str = PASSWORD,
    headers: dict[str, str] | None = None,
) -> Response:
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers=headers,
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
        "username": "reviewer-1",
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
        # Its sign-in session refers to the user, so it goes first.
        session.execute(delete(RefreshToken).where(RefreshToken.user_id == "auditor-1"))
        session.execute(delete(User).where(User.id == "auditor-1"))

    try:
        response = client.get("/api/auth/me", headers=bearer(token))
        assert response.status_code == 401
    finally:
        with create_session_factory(engine).begin() as session:
            session.add(
                User(
                    id="auditor-1",
                    username="auditor-1",
                    display_name="Taylor Morgan",
                    role="READONLY_AUDITOR",
                    password_hash=hash_password(PASSWORD),
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


# Signing in, renewing and signing out work without an access token.
PUBLIC_MUTATIONS = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/refresh"),
    ("POST", "/api/auth/logout"),
    # Choosing a password with a setup link: the link is the proof.
    ("POST", "/api/auth/setup-link"),
    ("POST", "/api/auth/set-password"),
}


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


@pytest.mark.parametrize("environment", ["production", "demo"])
def test_production_and_demo_require_a_real_jwt_secret(environment: str) -> None:
    with pytest.raises(ValueError, match=f"Set JWT_SECRET in {environment}"):
        Settings(
            _env_file=None,
            environment=environment,
            jwt_secret=SecretStr(DEVELOPMENT_JWT_SECRET),
        )

    with pytest.raises(ValueError, match="at least 32"):
        Settings(_env_file=None, environment=environment, jwt_secret=SecretStr("short"))

    Settings(
        _env_file=None,
        environment=environment,
        jwt_secret=SecretStr("a-production-secret-that-is-long-enough"),
    )


# --- Sessions --------------------------------------------------------------


def renewal_cookie(response: Response) -> str:
    value = response.cookies.get(RENEWAL_COOKIE)
    assert value, "the response set no renewal cookie"
    return value


def refresh_with(client: TestClient, cookie: str | None) -> Response:
    """Renew with exactly this cookie, ignoring any the client kept."""
    client.cookies.clear()
    headers = {"Cookie": f"{RENEWAL_COOKIE}={cookie}"} if cookie else {}
    return client.post("/api/auth/refresh", headers=headers)


def set_cookie_header(response: Response) -> str:
    return response.headers["set-cookie"].lower()


def set_active(engine: Engine, user_id: str, active: bool) -> None:
    with create_session_factory(engine).begin() as session:
        session.execute(update(User).where(User.id == user_id).values(is_active=active))


# --- Signing in -------------------------------------------------------------


def test_sign_in_uses_the_username_in_any_case(
    client: TestClient,
    engine: Engine,
) -> None:
    response = login(client, "  Reviewer-1 ")

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "reviewer-1"
    with Session(engine) as session:
        user = session.get(User, "reviewer-1")
        assert user is not None
        assert user.last_login_at is not None


def test_sign_in_is_by_username_not_by_id(client: TestClient, engine: Engine) -> None:
    with create_session_factory(engine).begin() as session:
        user = create_user(
            session,
            username="dr.park",
            display_name="Dr. Ada Park",
            role="CLINICIAN",
            password=PASSWORD,
            actor_id="admin-1",
            now=datetime.now(UTC),
        )
        user_id = user.id

    assert login(client, "dr.park").status_code == 200
    assert login(client, user_id).status_code == 401


def test_sign_in_sets_a_locked_down_renewal_cookie(client: TestClient) -> None:
    response = login(client, "clinician-1")

    header = set_cookie_header(response)
    assert "httponly" in header
    assert "samesite=strict" in header
    assert "path=/api/auth" in header
    assert "max-age=43200" in header  # 12 hours
    # Plain HTTP in development and tests; production adds Secure.
    assert "secure" not in header


def test_renewal_tokens_are_stored_only_as_hashes(
    client: TestClient,
    engine: Engine,
) -> None:
    cookie = renewal_cookie(login(client, "clinician-1"))

    with Session(engine) as session:
        stored = session.scalars(select(RefreshToken.token_hash)).all()
    assert stored == [sessions.hash_token(cookie)]
    assert cookie not in stored


@pytest.mark.parametrize("environment", ["production", "demo"])
def test_production_and_demo_cookies_need_https(environment: str) -> None:
    deployed = Settings(
        _env_file=None,
        environment=environment,
        jwt_secret=SecretStr("a-production-secret-that-is-long-enough"),
    )

    assert deployed.runs_like_production is True
    assert deployed.secure_cookies is True


def test_wrong_password_gets_the_ordinary_answer(client: TestClient) -> None:
    response = login(client, "reviewer-1", "not-the-password")

    assert response.status_code == 401
    assert response.json()["message"] == "The username or password is incorrect."
    assert RENEWAL_COOKIE not in response.cookies


def test_a_user_still_waiting_for_a_setup_link_cannot_sign_in(
    client: TestClient,
    engine: Engine,
) -> None:
    with create_session_factory(engine).begin() as session:
        create_user(
            session,
            username="not-yet",
            display_name="Not Yet",
            role="CLINICIAN",
            password=None,
            actor_id="admin-1",
            now=datetime.now(UTC),
        )

    response = login(client, "not-yet", "anything-at-all")

    assert response.status_code == 401
    assert response.json()["message"] == "The username or password is incorrect."


def test_deactivated_user_is_told_only_after_the_right_password(
    client: TestClient,
    engine: Engine,
) -> None:
    set_active(engine, "clinician-2", False)

    wrong = login(client, "clinician-2", "not-the-password")
    right = login(client, "clinician-2")

    assert wrong.status_code == 401
    assert right.status_code == 403
    assert right.json()["error"] == "account_deactivated"
    assert RENEWAL_COOKIE not in right.cookies


def test_deactivation_ends_access_with_an_existing_token(
    client: TestClient,
    engine: Engine,
) -> None:
    signed_in = login(client, "clinician-3")
    token = signed_in.json()["access_token"]
    cookie = renewal_cookie(signed_in)

    set_active(engine, "clinician-3", False)

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 401
    assert refresh_with(client, cookie).status_code == 401
    # The session is revoked, so reactivating does not bring it back.
    set_active(engine, "clinician-3", True)
    assert refresh_with(client, cookie).status_code == 401


# --- Renewing ---------------------------------------------------------------


def test_refresh_swaps_the_cookie_for_a_new_token_and_cookie(
    client: TestClient,
) -> None:
    first = renewal_cookie(login(client, "reviewer-2"))

    response = refresh_with(client, first)

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["id"] == "reviewer-2"
    assert body["expires_in"] == 15 * 60
    second = renewal_cookie(response)
    assert second != first
    me = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {body['access_token']}"},
    )
    assert me.json()["id"] == "reviewer-2"
    # And the new cookie renews again.
    assert refresh_with(client, second).status_code == 200


def test_renewing_never_extends_the_session(
    client: TestClient,
    engine: Engine,
) -> None:
    first = renewal_cookie(login(client, "reviewer-3"))
    refresh_with(client, first)

    with Session(engine) as session:
        ends = session.scalars(select(RefreshToken.expires_at)).all()
    assert len(ends) == 2
    assert len(set(ends)) == 1


def test_a_reused_cookie_ends_the_whole_session(client: TestClient) -> None:
    first = renewal_cookie(login(client, "reviewer-4"))
    second = renewal_cookie(refresh_with(client, first))

    # Someone presents the old cookie: it was copied.
    reused = refresh_with(client, first)

    assert reused.status_code == 401
    assert reused.json()["message"] == "Your session has ended. Sign in again."
    # The newest cookie is revoked too, so the copier gets nothing either.
    assert refresh_with(client, second).status_code == 401


def test_an_ended_session_cannot_be_renewed(
    client: TestClient,
    engine: Engine,
) -> None:
    cookie = renewal_cookie(login(client, "reviewer-5"))
    with create_session_factory(engine).begin() as session:
        session.execute(
            update(RefreshToken).values(
                created_at=func.now() - timedelta(hours=13),
                expires_at=func.now() - timedelta(hours=1),
            )
        )

    assert refresh_with(client, cookie).status_code == 401


@pytest.mark.parametrize("cookie", [None, "not-a-real-token"])
def test_refresh_without_a_valid_cookie_is_refused_and_clears_it(
    client: TestClient,
    cookie: str | None,
) -> None:
    response = refresh_with(client, cookie)

    assert response.status_code == 401
    assert response.json()["error"] == "unauthenticated"
    header = set_cookie_header(response)
    assert f"{RENEWAL_COOKIE}=" in header
    assert "max-age=0" in header


def test_two_renewals_with_one_cookie_cannot_both_succeed(
    client: TestClient,
    engine: Engine,
) -> None:
    cookie = renewal_cookie(login(client, "auditor-1"))
    factory = create_session_factory(engine)
    now = datetime.now(UTC)
    second: list[object] = []

    first_session = factory()
    try:
        first = sessions.renew(first_session, cookie, now)
        assert isinstance(first, sessions.SignedIn)

        def renew_again() -> None:
            with factory.begin() as session:
                second.append(sessions.renew(session, cookie, now))

        # Waits for the first renewal's row lock.
        waiting = threading.Thread(target=renew_again)
        waiting.start()
        waiting.join(timeout=0.5)
        assert waiting.is_alive(), "the second renewal did not wait for the first"
        first_session.commit()
        waiting.join(timeout=10)
    finally:
        first_session.close()

    assert len(second) == 1
    assert isinstance(second[0], ApiError)
    with Session(engine) as session:
        unrevoked = session.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.revoked_at.is_(None))
        )
    assert unrevoked == 0


# --- Signing out ------------------------------------------------------------


def test_logout_ends_the_session_and_clears_the_cookie(client: TestClient) -> None:
    cookie = renewal_cookie(login(client, "admin-1"))

    client.cookies.clear()
    response = client.post(
        "/api/auth/logout",
        headers={"Cookie": f"{RENEWAL_COOKIE}={cookie}"},
    )

    assert response.status_code == 204
    assert "max-age=0" in set_cookie_header(response)
    assert refresh_with(client, cookie).status_code == 401


def test_logout_without_a_session_still_succeeds(client: TestClient) -> None:
    client.cookies.clear()

    assert client.post("/api/auth/logout").status_code == 204


# --- Slowing down guessing --------------------------------------------------


def fail(client: TestClient, username: str, times: int) -> None:
    for _ in range(times):
        assert login(client, username, "wrong-password").status_code == 401


def test_too_many_failures_lock_the_username(client: TestClient) -> None:
    fail(client, "clinician-1", FAILURE_LIMIT)

    # Locked even with the right password.
    locked = login(client, "clinician-1")

    assert locked.status_code == 429
    assert locked.json()["error"] == "too_many_attempts"
    assert locked.json()["message"] == (
        "Too many failed sign-ins. Try again in 15 minutes."
    )
    assert 14 * 60 < int(locked.headers["retry-after"]) <= 15 * 60
    # Other users are not affected.
    assert login(client, "clinician-2").status_code == 200


def test_the_lock_lifts_once_the_failures_are_old(
    client: TestClient,
    engine: Engine,
) -> None:
    fail(client, "clinician-1", FAILURE_LIMIT)
    with create_session_factory(engine).begin() as session:
        session.execute(
            update(LoginAttempt).values(
                attempted_at=LoginAttempt.attempted_at - timedelta(minutes=16)
            )
        )

    assert login(client, "clinician-1").status_code == 200


def test_signing_in_clears_earlier_failures(client: TestClient) -> None:
    fail(client, "reviewer-1", FAILURE_LIMIT - 1)
    assert login(client, "reviewer-1").status_code == 200

    fail(client, "reviewer-1", FAILURE_LIMIT - 1)

    assert login(client, "reviewer-1").status_code == 200


def test_unknown_usernames_count_too(client: TestClient) -> None:
    fail(client, "Nobody.Here", FAILURE_LIMIT)

    assert login(client, "nobody.here", "anything").status_code == 429


def test_too_many_failures_from_one_address_lock_it(client: TestClient) -> None:
    for number in range(IP_FAILURE_LIMIT):
        fail(client, f"guess-{number}", 1)

    assert login(client, "reviewer-2").status_code == 429


def test_old_failures_are_removed(client: TestClient, engine: Engine) -> None:
    fail(client, "guess-a", 1)
    with create_session_factory(engine).begin() as session:
        session.execute(
            update(LoginAttempt).values(
                attempted_at=LoginAttempt.attempted_at - timedelta(hours=1)
            )
        )

    fail(client, "guess-b", 1)

    with Session(engine) as session:
        remaining = session.scalars(select(LoginAttempt.username)).all()
    assert remaining == ["guess-b"]


@pytest.mark.parametrize(
    ("seconds", "message"),
    [(30, "1 minute."), (60, "1 minute."), (61, "2 minutes.")],
)
def test_the_wait_is_given_in_whole_minutes(seconds: int, message: str) -> None:
    error = sessions.too_many_attempts(timedelta(seconds=seconds))

    assert error.message.endswith(message)
    assert error.headers == {"Retry-After": str(seconds)}


# --- Requests from other sites ----------------------------------------------


@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/refresh"])
def test_requests_from_other_sites_are_refused(client: TestClient, path: str) -> None:
    response = client.post(
        path,
        json={"username": "reviewer-1", "password": PASSWORD},
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
    assert response.json()["message"] == (
        "This request did not come from the application."
    )


def test_logout_from_another_site_is_refused(client: TestClient) -> None:
    cookie = renewal_cookie(login(client, "reviewer-1"))

    client.cookies.clear()
    response = client.post(
        "/api/auth/logout",
        headers={
            "Origin": "https://attacker.example",
            "Cookie": f"{RENEWAL_COOKIE}={cookie}",
        },
    )

    assert response.status_code == 403
    assert refresh_with(client, cookie).status_code == 200


@pytest.mark.parametrize("origin", ["http://testserver", "http://localhost:5173"])
def test_requests_from_the_application_are_accepted(
    client: TestClient,
    origin: str,
) -> None:
    response = login(client, "reviewer-1", headers={"Origin": origin})

    assert response.status_code == 200
