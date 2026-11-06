"""Sign-in sessions: checking a sign-in, renewal tokens and the lockout.

A sign-in starts a session: a family of renewal tokens, each usable once.
Renewing replaces the token with a new one in the same family; the session
ends a fixed time after the sign-in however often it is renewed. A replaced
token presented again means it was copied, so the whole family is revoked:
whoever holds the newest token is signed out too and must sign in again.

These functions return an ApiError instead of raising it, so the caller can
commit what they recorded (a failed attempt, a revoked session) before
answering with the error.
"""

import hashlib
import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from clinical_notes_api.accounts.users import AccountError, normalize_username
from clinical_notes_api.config import Settings
from clinical_notes_api.db import LoginAttempt, RefreshToken, User
from clinical_notes_api.db.models import LOGIN_USERNAME_LENGTH
from clinical_notes_api.errors import ApiError, unauthenticated
from clinical_notes_api.security import verify_password

RENEWAL_TOKEN_BYTES = 32

INVALID_CREDENTIALS = "The username or password is incorrect."
SESSION_ENDED = "Your session has ended. Sign in again."


@dataclass(frozen=True)
class Renewal:
    """A new renewal token, to hand to the browser as a cookie."""

    token: str
    expires_at: datetime


@dataclass(frozen=True)
class SignedIn:
    user: User
    renewal: Renewal


def hash_token(token: str) -> str:
    """What is stored instead of a token: its SHA-256, in hex."""
    return hashlib.sha256(token.encode()).hexdigest()


def account_deactivated() -> ApiError:
    return ApiError(
        403,
        "account_deactivated",
        "This account is deactivated. Ask an administrator to reactivate it.",
    )


def too_many_attempts(wait: timedelta) -> ApiError:
    seconds = max(1, math.ceil(wait.total_seconds()))
    minutes = math.ceil(seconds / 60)
    return ApiError(
        429,
        "too_many_attempts",
        f"Too many failed sign-ins. Try again in {minutes} "
        f"minute{'s' if minutes != 1 else ''}.",
        headers={"Retry-After": str(seconds)},
    )


# --- Signing in -------------------------------------------------------------


def sign_in(
    session: Session,
    *,
    username: str,
    password: str,
    ip_address: str,
    now: datetime,
    settings: Settings,
) -> SignedIn | ApiError:
    """Check a sign-in and start a session, or say why not.

    An unknown username, a wrong password and an account that has no
    password yet get the same answer and the same hashing work, so the
    answer does not reveal which usernames exist. Only someone who knows the
    password learns that an account is deactivated.
    """
    typed = username.strip().lower()[:LOGIN_USERNAME_LENGTH]

    locked_until = lockout_ends_at(
        session,
        username=typed,
        ip_address=ip_address,
        now=now,
        settings=settings,
    )
    if locked_until is not None:
        return too_many_attempts(locked_until - now)

    user = _find_user(session, username)
    password_hash = user.password_hash if user is not None else None
    if not verify_password(password, password_hash) or user is None:
        record_failed_sign_in(
            session,
            username=typed,
            ip_address=ip_address,
            now=now,
            settings=settings,
        )
        return unauthenticated(INVALID_CREDENTIALS)

    if not user.is_active:
        return account_deactivated()

    session.execute(delete(LoginAttempt).where(LoginAttempt.username == typed))
    # Sessions that ended on their own are no longer needed.
    session.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == user.id,
            RefreshToken.expires_at <= now,
        )
    )
    user.last_login_at = now
    renewal = _issue(
        session,
        user_id=user.id,
        family_id=f"session-{uuid.uuid4()}",
        now=now,
        expires_at=now + timedelta(hours=settings.session_hours),
    )[1]
    return SignedIn(user=user, renewal=renewal)


def _find_user(session: Session, username: str) -> User | None:
    try:
        normalized = normalize_username(username)
    except AccountError:
        # Cannot be anyone's username; still answered like a wrong password.
        return None
    return session.scalar(select(User).where(User.username == normalized))


# --- Slowing down guessing --------------------------------------------------


def lockout_ends_at(
    session: Session,
    *,
    username: str,
    ip_address: str,
    now: datetime,
    settings: Settings,
) -> datetime | None:
    """When sign-ins for this username or from this address open again.

    None when neither is locked. A lock lifts once enough of the recent
    failures are older than the window.
    """
    window = timedelta(minutes=settings.login_lockout_minutes)
    ends = []
    for column, value, limit in (
        (LoginAttempt.username, username, settings.login_failure_limit),
        (LoginAttempt.ip_address, ip_address, settings.login_ip_failure_limit),
    ):
        # The limit-th most recent failure: the lock lifts when it ages out.
        oldest_counted = session.scalar(
            select(LoginAttempt.attempted_at)
            .where(column == value, LoginAttempt.attempted_at > now - window)
            .order_by(LoginAttempt.attempted_at.desc())
            .offset(limit - 1)
            .limit(1)
        )
        if oldest_counted is not None:
            ends.append(oldest_counted + window)
    return max(ends) if ends else None


def record_failed_sign_in(
    session: Session,
    *,
    username: str,
    ip_address: str,
    now: datetime,
    settings: Settings,
) -> None:
    window = timedelta(minutes=settings.login_lockout_minutes)
    # Failures older than the window no longer count for anything.
    session.execute(
        delete(LoginAttempt).where(LoginAttempt.attempted_at <= now - window)
    )
    session.add(
        LoginAttempt(username=username, ip_address=ip_address, attempted_at=now)
    )


# --- Renewing and ending sessions -------------------------------------------


def renew(session: Session, token: str | None, now: datetime) -> SignedIn | ApiError:
    """Swap a renewal token for a new one in the same session."""
    if not token:
        return unauthenticated()

    current = session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(token))
        # Two renewals with the same token: the second waits, then finds it
        # already replaced.
        .with_for_update()
    )
    if current is None:
        return unauthenticated(SESSION_ENDED)

    if current.replaced_by_id is not None:
        # Used before: someone has a copy. End the session for everyone.
        revoke_family(session, current.family_id, now)
        return unauthenticated(SESSION_ENDED)

    if current.revoked_at is not None or current.expires_at <= now:
        return unauthenticated(SESSION_ENDED)

    user = session.get(User, current.user_id)
    if user is None or not user.is_active or user.password_hash is None:
        revoke_family(session, current.family_id, now)
        return unauthenticated(SESSION_ENDED)

    replacement, renewal = _issue(
        session,
        user_id=user.id,
        family_id=current.family_id,
        now=now,
        # The session keeps its end time; renewing never extends it.
        expires_at=current.expires_at,
    )
    current.revoked_at = now
    current.replaced_by_id = replacement.id
    return SignedIn(user=user, renewal=renewal)


def end_session(session: Session, token: str | None, now: datetime) -> None:
    """Sign out: revoke the session the renewal token belongs to, if any."""
    if not token:
        return
    current = session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(token))
    )
    if current is not None:
        revoke_family(session, current.family_id, now)


def revoke_family(session: Session, family_id: str, now: datetime) -> None:
    session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def _issue(
    session: Session,
    *,
    user_id: str,
    family_id: str,
    now: datetime,
    expires_at: datetime,
) -> tuple[RefreshToken, Renewal]:
    token = secrets.token_urlsafe(RENEWAL_TOKEN_BYTES)
    row = RefreshToken(
        id=f"renewal-{uuid.uuid4()}",
        user_id=user_id,
        family_id=family_id,
        token_hash=hash_token(token),
        created_at=now,
        expires_at=expires_at,
    )
    session.add(row)
    # Written now, so the token it replaces can refer to it.
    session.flush()
    return row, Renewal(token=token, expires_at=expires_at)
