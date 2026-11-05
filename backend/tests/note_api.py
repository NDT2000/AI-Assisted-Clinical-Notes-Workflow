"""Shared constants and helpers for tests of the note endpoints.

The fixtures that use them are in conftest.py.
"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from clinical_notes_api.config import Settings
from clinical_notes_api.security import create_access_token

NOTE_COUNT = 60
SEED = 42
PASSWORD = "test-password"  # noqa: S105 - test fixture


def auth(user_id: str, settings: Settings) -> dict[str, str]:
    # Roles are read from the database; the token only names the user.
    token, _ = create_access_token(
        user_id=user_id,
        role="CLINICIAN",
        mfa_verified=False,
        settings=settings,
        now=datetime.now(UTC),
    )
    return {"Authorization": f"Bearer {token}"}


def current_version_id(client: TestClient, headers: dict, note_id: str) -> str:
    return client.get(f"/api/notes/{note_id}", headers=headers).json()["note"][
        "currentVersionId"
    ]


def content(**changes: str) -> dict[str, str]:
    return {
        "subjective": "Patient feels better. Sleeping well.",
        "objective": "Vitals stable.",
        "assessment": "Improving.",
        "plan": "Review in two weeks.",
        **changes,
    }
