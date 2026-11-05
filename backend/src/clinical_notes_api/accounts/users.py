"""Creating accounts: sign-in names, passwords, ids and the audit record."""

import re
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from clinical_notes_api.db import User, UserAdminEvent
from clinical_notes_api.db.models import USER_ROLES, USERNAME_PATTERN, UserRole
from clinical_notes_api.security import hash_password

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256
MAX_DISPLAY_NAME_LENGTH = 200

# Roles whose accounts have the (stand-in) second factor switched on;
# approving a note requires it.
MFA_ROLES = frozenset({"REVIEWER", "ADMIN"})

_USERNAME = re.compile(USERNAME_PATTERN)


class AccountError(ValueError):
    """A request to create or change an account that breaks a rule."""


def normalize_username(raw: str) -> str:
    """The username as stored: trimmed and lowercase, or AccountError."""
    username = raw.strip().lower()
    if not _USERNAME.fullmatch(username):
        raise AccountError(
            "A username is 3 to 32 characters: lowercase letters, digits, "
            "dots, dashes or underscores."
        )
    return username


def check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AccountError(
            f"A password needs at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise AccountError(
            f"A password can have at most {MAX_PASSWORD_LENGTH} characters."
        )


def check_display_name(raw: str) -> str:
    name = raw.strip()
    if not name:
        raise AccountError("Enter the person's name.")
    if len(name) > MAX_DISPLAY_NAME_LENGTH:
        raise AccountError(
            f"A name can have at most {MAX_DISPLAY_NAME_LENGTH} characters."
        )
    return name


def new_user_id() -> str:
    """Internal id for a new account; people see the username instead."""
    return f"user-{uuid.uuid4().hex[:12]}"


def record_admin_event(
    session: Session,
    *,
    action: str,
    target_user_id: str,
    actor_id: str | None,
    occurred_at: datetime,
    details: dict[str, Any] | None = None,
) -> None:
    session.add(
        UserAdminEvent(
            event_id=f"user-event-{uuid.uuid4()}",
            actor_id=actor_id,
            target_user_id=target_user_id,
            action=action,
            details=details or {},
            occurred_at=occurred_at,
        )
    )


def create_user(
    session: Session,
    *,
    username: str,
    display_name: str,
    role: UserRole,
    password: str | None,
    actor_id: str | None,
    now: datetime,
) -> User:
    """Create an account and record who created it; the caller commits.

    `password` is None for a user who will choose one from a setup link.
    `actor_id` is None when a command, not a signed-in admin, creates it.
    """
    username = normalize_username(username)
    display_name = check_display_name(display_name)
    if role not in USER_ROLES:
        raise AccountError(f"{role} is not a role.")
    if password is not None:
        check_password(password)
    if session.scalar(select(User.id).where(User.username == username)):
        raise AccountError(f"The username {username} is already taken.")

    user = User(
        id=new_user_id(),
        username=username,
        display_name=display_name,
        role=role,
        password_hash=hash_password(password) if password is not None else None,
        mfa_enabled=role in MFA_ROLES,
        is_active=True,
        created_at=now,
        created_by_id=actor_id,
    )
    session.add(user)
    # The user row first: the audit record refers to it.
    session.flush()
    record_admin_event(
        session,
        action="CREATED",
        target_user_id=user.id,
        actor_id=actor_id,
        occurred_at=now,
        details={"username": username, "role": role},
    )
    session.flush()
    return user
