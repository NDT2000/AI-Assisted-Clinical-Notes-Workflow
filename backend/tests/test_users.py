"""The administrator's user management, the directory and setup links.

Uses the shared note fixtures: 60 seeded notes, each test rolled back.
"""

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from clinical_notes_api.accounts.admin import OPEN_REVIEW_STATUSES
from clinical_notes_api.accounts.sessions import hash_token
from clinical_notes_api.auth import RENEWAL_COOKIE
from clinical_notes_api.db import Note, RefreshToken, User, UserSetupLink
from tests.note_api import PASSWORD

NEW_PASSWORD = "a brand new password"  # noqa: S105 - test fixture


@pytest.fixture
def admin(as_user) -> dict[str, str]:
    return as_user("admin-1")


def token_of(setup_link: dict) -> str:
    return urlsplit(setup_link["url"]).fragment


def create(client: TestClient, admin: dict, **changes: str):
    body = {"username": "dr.park", "displayName": "Dr. Ada Park", "role": "CLINICIAN"}
    return client.post("/api/users", json={**body, **changes}, headers=admin)


def login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


def set_password(client: TestClient, token: str, password: str = NEW_PASSWORD):
    return client.post(
        "/api/auth/set-password",
        json={"token": token, "password": password},
    )


def reviewer_with_open_reviews(db: Session) -> tuple[str, int]:
    reviewer_id, count = db.execute(
        select(Note.assigned_reviewer_id, func.count())
        .where(
            Note.status.in_(OPEN_REVIEW_STATUSES),
            Note.assigned_reviewer_id.is_not(None),
        )
        .group_by(Note.assigned_reviewer_id)
        .order_by(Note.assigned_reviewer_id)
        .limit(1)
    ).one()
    return reviewer_id, count


def actions(detail: dict) -> list[str]:
    return [event["action"] for event in detail["history"]]


# --- Who may do what --------------------------------------------------------


ADMIN_ENDPOINTS = [
    ("GET", "/api/users", None),
    (
        "POST",
        "/api/users",
        {"username": "x-y-z", "displayName": "X", "role": "CLINICIAN"},
    ),
    ("GET", "/api/users/clinician-1", None),
    ("PATCH", "/api/users/clinician-1", {"displayName": "Changed"}),
    ("POST", "/api/users/clinician-1/deactivate", None),
    ("POST", "/api/users/clinician-1/reactivate", None),
    ("POST", "/api/users/clinician-1/setup-link", None),
]


@pytest.mark.parametrize("user_id", ["clinician-2", "reviewer-1", "auditor-1"])
@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ENDPOINTS)
def test_only_administrators_manage_accounts(
    client: TestClient,
    as_user,
    user_id: str,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    response = client.request(method, path, json=body, headers=as_user(user_id))

    assert response.status_code == 403
    assert response.json()["message"] == "Only an administrator can manage accounts."


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_ENDPOINTS)
def test_account_endpoints_require_sign_in(
    client: TestClient,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    assert client.request(method, path, json=body).status_code == 401


def test_unknown_users_are_not_found(client: TestClient, admin: dict) -> None:
    response = client.get("/api/users/nobody", headers=admin)

    assert response.status_code == 404
    assert client.post("/api/users/nobody/reactivate", headers=admin).status_code == 404


# --- Listing ----------------------------------------------------------------


def test_list_shows_every_account(client: TestClient, admin: dict) -> None:
    users = client.get("/api/users", headers=admin).json()["users"]

    assert len(users) == 10
    assert {user["status"] for user in users} == {"ACTIVE"}
    # By name, in the database's collation.
    assert users[0]["displayName"] == "Alex Kim"
    assert set(users[0]) == {
        "id",
        "username",
        "displayName",
        "role",
        "status",
        "mfaEnabled",
        "createdAt",
        "createdById",
        "lastLoginAt",
    }


def test_list_filters(client: TestClient, admin: dict) -> None:
    def ids(query: str) -> list[str]:
        response = client.get(f"/api/users?{query}", headers=admin)
        return [user["id"] for user in response.json()["users"]]

    assert sorted(ids("role=REVIEWER")) == [f"reviewer-{n}" for n in range(1, 6)]
    assert ids("q=kim") == ["reviewer-1"]
    assert ids("q=AUDITOR") == ["auditor-1"]
    assert ids("q=%25") == []  # a literal %, not "anything"
    assert ids("active=false") == []

    client.post("/api/users/clinician-1/deactivate", headers=admin)
    assert ids("active=false") == ["clinician-1"]


# --- Creating accounts and setup links --------------------------------------


def test_create_gives_an_account_without_a_password_and_a_link(
    client: TestClient,
    admin: dict,
    db: Session,
) -> None:
    before = datetime.now(UTC)
    response = create(client, admin, role="REVIEWER")

    assert response.status_code == 201
    body = response.json()
    user = body["user"]
    assert user["username"] == "dr.park"
    assert user["status"] == "SETUP_PENDING"
    assert user["mfaEnabled"] is True
    assert user["createdById"] == "admin-1"
    link = body["setupLink"]
    assert link["url"].startswith("http://localhost:5173/set-password#")
    expires = datetime.fromisoformat(link["expiresAt"])
    assert timedelta(hours=71) < expires - before <= timedelta(hours=72, minutes=1)

    stored = db.scalars(select(UserSetupLink.token_hash)).all()
    assert stored == [hash_token(token_of(link))]
    detail = client.get(f"/api/users/{user['id']}", headers=admin).json()
    assert detail["setupLinkExpiresAt"] == link["expiresAt"]
    assert sorted(actions(detail)) == ["CREATED", "SETUP_LINK_ISSUED"]
    # The log says when the link expires, never what it is.
    assert token_of(link) not in str(detail["history"])


@pytest.mark.parametrize(
    ("changes", "status", "error"),
    [
        ({"username": "Clinician-1"}, 409, "username_taken"),
        ({"username": "no spaces"}, 400, "invalid_request"),
        ({"displayName": "   "}, 400, "invalid_request"),
        ({"role": "PATIENT"}, 400, "invalid_request"),
    ],
)
def test_create_refuses_bad_accounts(
    client: TestClient,
    admin: dict,
    changes: dict,
    status: int,
    error: str,
) -> None:
    response = create(client, admin, **changes)

    assert response.status_code == status
    assert response.json()["error"] == error


def test_a_new_user_chooses_a_password_and_signs_in(
    client: TestClient,
    admin: dict,
) -> None:
    created = create(client, admin).json()
    token = token_of(created["setupLink"])

    check = client.post("/api/auth/setup-link", json={"token": token})
    assert check.status_code == 200
    assert check.json()["username"] == "dr.park"
    assert check.json()["displayName"] == "Dr. Ada Park"

    assert set_password(client, token).status_code == 204
    assert login(client, "dr.park", NEW_PASSWORD).status_code == 200

    # The link works once.
    again = set_password(client, token, "yet another password")
    assert again.status_code == 400
    assert again.json()["error"] == "invalid_setup_link"
    assert client.post("/api/auth/setup-link", json={"token": token}).status_code == 400

    detail = client.get(f"/api/users/{created['user']['id']}", headers=admin).json()
    assert detail["user"]["status"] == "ACTIVE"
    assert detail["setupLinkExpiresAt"] is None
    assert actions(detail)[0] == "PASSWORD_SET"
    assert detail["history"][0]["actorId"] == created["user"]["id"]


def test_a_short_password_is_refused_and_the_link_still_works(
    client: TestClient,
    admin: dict,
) -> None:
    token = token_of(create(client, admin).json()["setupLink"])

    short = set_password(client, token, "too short")

    assert short.status_code == 400
    assert "at least 12" in short.json()["message"]
    assert set_password(client, token).status_code == 204


def test_an_expired_link_is_refused(
    client: TestClient,
    admin: dict,
    db: Session,
) -> None:
    token = token_of(create(client, admin).json()["setupLink"])
    db.execute(
        update(UserSetupLink).values(
            created_at=func.now() - timedelta(hours=80),
            expires_at=func.now() - timedelta(hours=8),
        )
    )
    db.flush()

    assert set_password(client, token).status_code == 400


def test_an_unknown_link_is_refused(client: TestClient) -> None:
    response = client.post("/api/auth/setup-link", json={"token": "made-up"})

    assert response.status_code == 400
    assert "Ask an administrator for a new one" in response.json()["message"]


def test_a_new_link_replaces_the_old_one(client: TestClient, admin: dict) -> None:
    created = create(client, admin).json()
    first = token_of(created["setupLink"])

    second = client.post(
        f"/api/users/{created['user']['id']}/setup-link",
        headers=admin,
    )

    assert second.status_code == 201
    assert set_password(client, first).status_code == 400
    assert set_password(client, token_of(second.json())).status_code == 204


def test_a_link_resets_an_existing_password_and_ends_sessions(
    client: TestClient,
    admin: dict,
) -> None:
    signed_in = login(client, "clinician-1", PASSWORD)
    cookie = signed_in.cookies.get(RENEWAL_COOKIE)
    link = client.post("/api/users/clinician-1/setup-link", headers=admin).json()

    # The old password works until the link is used.
    assert login(client, "clinician-1", PASSWORD).status_code == 200
    assert set_password(client, token_of(link)).status_code == 204

    assert login(client, "clinician-1", PASSWORD).status_code == 401
    assert login(client, "clinician-1", NEW_PASSWORD).status_code == 200
    client.cookies.clear()
    renewed = client.post(
        "/api/auth/refresh",
        headers={"Cookie": f"{RENEWAL_COOKIE}={cookie}"},
    )
    assert renewed.status_code == 401


def test_no_setup_link_for_a_deactivated_account(
    client: TestClient,
    admin: dict,
) -> None:
    link = client.post("/api/users/clinician-1/setup-link", headers=admin).json()
    client.post("/api/users/clinician-1/deactivate", headers=admin)

    refused = client.post("/api/users/clinician-1/setup-link", headers=admin)

    assert refused.status_code == 409
    assert refused.json()["error"] == "account_deactivated"
    # A link issued before the deactivation stops working too.
    assert set_password(client, token_of(link)).status_code == 400


# --- Changing accounts ------------------------------------------------------


def test_admin_renames_and_changes_roles(
    client: TestClient,
    admin: dict,
    db: Session,
) -> None:
    response = client.patch(
        "/api/users/clinician-1",
        json={
            "username": "Morgan.Diaz",
            "displayName": "Dr. Morgan Diaz",
            "role": "REVIEWER",
        },
        headers=admin,
    )

    assert response.status_code == 200
    detail = response.json()
    assert detail["user"]["username"] == "morgan.diaz"
    assert detail["user"]["displayName"] == "Dr. Morgan Diaz"
    assert detail["user"]["role"] == "REVIEWER"
    assert detail["user"]["mfaEnabled"] is True
    events = {event["details"].get("field"): event for event in detail["history"]}
    assert events["username"]["details"]["to"] == "morgan.diaz"
    assert events["username"]["action"] == "RENAMED"
    assert events["role"]["details"] == {
        "field": "role",
        "from": "CLINICIAN",
        "to": "REVIEWER",
    }
    assert events["role"]["actorName"] == "Jordan Lee"
    assert login(client, "morgan.diaz", PASSWORD).status_code == 200


def test_unchanged_values_are_not_logged(client: TestClient, admin: dict) -> None:
    detail = client.patch(
        "/api/users/clinician-1",
        json={"role": "CLINICIAN", "username": "CLINICIAN-1"},
        headers=admin,
    ).json()

    assert detail["history"] == []


@pytest.mark.parametrize(
    ("body", "status", "error"),
    [
        ({}, 400, "invalid_request"),
        ({"username": "clinician-2"}, 409, "username_taken"),
        ({"username": "x"}, 400, "invalid_request"),
        ({"displayName": ""}, 400, "invalid_request"),
    ],
)
def test_bad_changes_are_refused(
    client: TestClient,
    admin: dict,
    body: dict,
    status: int,
    error: str,
) -> None:
    response = client.patch("/api/users/clinician-1", json=body, headers=admin)

    assert response.status_code == status
    assert response.json()["error"] == error


def test_admins_cannot_lock_themselves_out(client: TestClient, admin: dict) -> None:
    demote = client.patch(
        "/api/users/admin-1", json={"role": "CLINICIAN"}, headers=admin
    )
    deactivate = client.post("/api/users/admin-1/deactivate", headers=admin)
    rename = client.patch(
        "/api/users/admin-1", json={"displayName": "J. Lee"}, headers=admin
    )

    assert demote.status_code == 409
    assert demote.json()["error"] == "own_account"
    assert deactivate.status_code == 409
    assert rename.status_code == 200


def test_another_admin_can_be_demoted(client: TestClient, admin: dict, as_user) -> None:
    created = create(client, admin, username="second-admin", role="ADMIN").json()
    set_password(client, token_of(created["setupLink"]))
    second = created["user"]["id"]

    # The second administrator demotes the first; admin-1 is no longer one.
    response = client.patch(
        "/api/users/admin-1",
        json={"role": "CLINICIAN"},
        headers=as_user(second),
    )

    assert response.status_code == 200
    assert client.get("/api/users", headers=admin).status_code == 403


# --- Deactivating -----------------------------------------------------------


def test_deactivation_ends_sessions_and_access(
    client: TestClient,
    admin: dict,
    as_user,
    db: Session,
) -> None:
    login(client, "clinician-1", PASSWORD)

    response = client.post("/api/users/clinician-1/deactivate", headers=admin)

    assert response.status_code == 200
    assert response.json()["user"]["status"] == "DEACTIVATED"
    assert actions(response.json()) == ["DEACTIVATED"]
    open_sessions = db.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .where(RefreshToken.user_id == "clinician-1", RefreshToken.revoked_at.is_(None))
    )
    assert open_sessions == 0
    assert client.get("/api/auth/me", headers=as_user("clinician-1")).status_code == 401
    assert login(client, "clinician-1", PASSWORD).status_code == 403

    # Again: nothing changes, nothing more is logged.
    again = client.post("/api/users/clinician-1/deactivate", headers=admin)
    assert actions(again.json()) == ["DEACTIVATED"]


def test_reactivation(client: TestClient, admin: dict) -> None:
    client.post("/api/users/clinician-1/deactivate", headers=admin)

    response = client.post("/api/users/clinician-1/reactivate", headers=admin)

    assert response.json()["user"]["status"] == "ACTIVE"
    assert actions(response.json()) == ["REACTIVATED", "DEACTIVATED"]
    assert login(client, "clinician-1", PASSWORD).status_code == 200
    again = client.post("/api/users/clinician-1/reactivate", headers=admin)
    assert len(again.json()["history"]) == 2


def test_a_reviewer_with_open_reviews_needs_confirmation(
    client: TestClient,
    admin: dict,
    db: Session,
) -> None:
    reviewer_id, count = reviewer_with_open_reviews(db)

    refused = client.post(f"/api/users/{reviewer_id}/deactivate", headers=admin)

    assert refused.status_code == 409
    assert refused.json()["error"] == "has_open_reviews"
    assert refused.json()["openReviewCount"] == count
    assert db.get(User, reviewer_id).is_active is True

    confirmed = client.post(
        f"/api/users/{reviewer_id}/deactivate",
        json={"confirmOpenReviews": True},
        headers=admin,
    )

    assert confirmed.status_code == 200
    assert confirmed.json()["openReviewCount"] == count
    assert confirmed.json()["history"][0]["details"] == {"openReviewCount": count}
    # The notes stay assigned until someone reassigns them.
    assigned = db.scalar(
        select(func.count())
        .select_from(Note)
        .where(Note.assigned_reviewer_id == reviewer_id)
    )
    assert assigned >= count


def test_deactivated_reviewers_cannot_be_assigned(
    client: TestClient,
    admin: dict,
    db: Session,
) -> None:
    note_id = db.scalar(select(Note.id).where(Note.status == "READY_FOR_REVIEW"))
    reviewer_id, _ = reviewer_with_open_reviews(db)
    client.post(
        f"/api/users/{reviewer_id}/deactivate",
        json={"confirmOpenReviews": True},
        headers=admin,
    )

    response = client.post(
        "/api/notes/bulk/assign-reviewer",
        json={"noteIds": [note_id], "reviewerId": reviewer_id},
        headers=admin,
    )

    assert response.status_code == 400
    assert "is deactivated" in response.json()["message"]


# --- The directory ----------------------------------------------------------


def test_everyone_can_read_the_directory_of_active_people(
    client: TestClient,
    admin: dict,
    as_user,
) -> None:
    clinician = as_user("clinician-1")

    reviewers = client.get("/api/users/directory?role=REVIEWER", headers=clinician)

    assert reviewers.status_code == 200
    assert reviewers.json()["users"][0] == {
        "id": "reviewer-1",
        "displayName": "Alex Kim",
        "role": "REVIEWER",
    }
    assert len(reviewers.json()["users"]) == 5
    everyone = client.get("/api/users/directory", headers=clinician).json()["users"]
    assert len(everyone) == 10

    client.post(
        "/api/users/reviewer-2/deactivate",
        json={"confirmOpenReviews": True},
        headers=admin,
    )
    after = client.get("/api/users/directory?role=REVIEWER", headers=clinician).json()
    assert "reviewer-2" not in [user["id"] for user in after["users"]]


def test_the_directory_requires_sign_in(client: TestClient) -> None:
    assert client.get("/api/users/directory").status_code == 401
