"""One-time setup links, with which a person chooses their password.

An administrator issues a link for a new account, or for an existing one as a
password reset. The link is shown once; only its hash is stored. A newer link
replaces any earlier unused one, and using a link signs the person out
everywhere.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from clinical_notes_api.accounts.sessions import hash_token, revoke_user_sessions
from clinical_notes_api.accounts.users import (
    AccountError,
    check_password,
    record_admin_event,
)
from clinical_notes_api.config import Settings
from clinical_notes_api.db import User, UserSetupLink
from clinical_notes_api.errors import ApiError, invalid_request
from clinical_notes_api.security import hash_password

SETUP_TOKEN_BYTES = 32
SETUP_PATH = "/set-password"

INVALID_LINK = (
    "This setup link is invalid, has expired or was already used. Ask an "
    "administrator for a new one."
)


@dataclass(frozen=True)
class IssuedLink:
    url: str
    expires_at: datetime


def invalid_setup_link() -> ApiError:
    return ApiError(400, "invalid_setup_link", INVALID_LINK)


def setup_url(token: str, settings: Settings) -> str:
    # The token goes after "#", which browsers never send to a server, so it
    # does not end up in access logs.
    return f"{settings.app_base_url.rstrip('/')}{SETUP_PATH}#{token}"


def issue(
    session: Session,
    *,
    user: User,
    actor_id: str | None,
    now: datetime,
    settings: Settings,
) -> IssuedLink:
    """A new link for the user; earlier unused links stop working."""
    session.execute(
        delete(UserSetupLink).where(
            UserSetupLink.user_id == user.id,
            UserSetupLink.used_at.is_(None),
        )
    )
    token = secrets.token_urlsafe(SETUP_TOKEN_BYTES)
    expires_at = now + timedelta(hours=settings.setup_link_hours)
    session.add(
        UserSetupLink(
            id=f"setup-link-{uuid.uuid4()}",
            user_id=user.id,
            token_hash=hash_token(token),
            created_by_id=actor_id,
            created_at=now,
            expires_at=expires_at,
        )
    )
    record_admin_event(
        session,
        action="SETUP_LINK_ISSUED",
        target_user_id=user.id,
        actor_id=actor_id,
        occurred_at=now,
        # When it expires, never the link itself.
        details={"expiresAt": expires_at.isoformat()},
    )
    session.flush()
    return IssuedLink(url=setup_url(token, settings), expires_at=expires_at)


def pending_link_expiry(
    session: Session,
    user_id: str,
    now: datetime,
) -> datetime | None:
    """When the user's unused link expires, or None if they have none."""
    return session.scalar(
        select(UserSetupLink.expires_at).where(
            UserSetupLink.user_id == user_id,
            UserSetupLink.used_at.is_(None),
            UserSetupLink.expires_at > now,
        )
    )


def find(
    session: Session,
    token: str,
    now: datetime,
    *,
    lock: bool = False,
) -> tuple[UserSetupLink, User] | None:
    """The unused, unexpired link and its active user, or None."""
    query = select(UserSetupLink).where(UserSetupLink.token_hash == hash_token(token))
    if lock:
        # Two uses of one link at once: the second waits, then finds it used.
        query = query.with_for_update()
    link = session.scalar(query)
    if link is None or link.used_at is not None or link.expires_at <= now:
        return None
    user = session.get(User, link.user_id)
    if user is None or not user.is_active:
        return None
    return link, user


def set_password(session: Session, token: str, password: str, now: datetime) -> User:
    """Use a link: set the password and sign the person out everywhere."""
    found = find(session, token, now, lock=True)
    if found is None:
        raise invalid_setup_link()
    link, user = found
    try:
        check_password(password)
    except AccountError as error:
        raise invalid_request(str(error)) from error

    user.password_hash = hash_password(password)
    link.used_at = now
    revoke_user_sessions(session, user.id, now)
    record_admin_event(
        session,
        action="PASSWORD_SET",
        target_user_id=user.id,
        # The person themselves, using the link.
        actor_id=user.id,
        occurred_at=now,
    )
    session.flush()
    return user
