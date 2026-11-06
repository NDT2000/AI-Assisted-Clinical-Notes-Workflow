"""What an administrator can do with accounts, and the rules that guard it.

- No one can deactivate themselves or change their own role.
- There is always at least one active administrator who can sign in.
- A reviewer with notes waiting for or under their review is deactivated
  only once the administrator confirms it.

Every change is recorded in the admin action log with the administrator who
made it. The caller commits; a refused request changes nothing.
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from clinical_notes_api.accounts import setup_links
from clinical_notes_api.accounts.sessions import revoke_user_sessions
from clinical_notes_api.accounts.users import (
    MFA_ROLES,
    AccountError,
    check_display_name,
    create_user,
    normalize_username,
    record_admin_event,
)
from clinical_notes_api.config import Settings
from clinical_notes_api.db import Note, User, UserAdminEvent
from clinical_notes_api.db.models import UserRole
from clinical_notes_api.errors import (
    ApiError,
    conflict,
    forbidden,
    invalid_request,
    not_found,
)

# Notes still waiting for, or under, their assigned reviewer.
OPEN_REVIEW_STATUSES = ("READY_FOR_REVIEW", "IN_REVIEW")


def require_admin(user: User) -> None:
    if user.role != "ADMIN":
        raise forbidden("Only an administrator can manage accounts.")


def _account_error(error: AccountError) -> ApiError:
    message = str(error)
    if "already taken" in message:
        return conflict("username_taken", message)
    return invalid_request(message)


# --- Reading ----------------------------------------------------------------


def list_users(
    session: Session,
    *,
    role: UserRole | None = None,
    active: bool | None = None,
    search: str = "",
) -> list[User]:
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    if active is not None:
        query = query.where(User.is_active.is_(active))
    if search.strip():
        pattern = f"%{_escape_like(search.strip())}%"
        query = query.where(
            or_(
                User.display_name.ilike(pattern, escape="\\"),
                User.username.ilike(pattern, escape="\\"),
            )
        )
    return list(session.scalars(query.order_by(User.display_name, User.id)))


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def directory(session: Session, role: UserRole | None) -> list[User]:
    """Active people, for choosing someone (such as a reviewer)."""
    return list_users(session, role=role, active=True)


@dataclass(frozen=True)
class HistoryEntry:
    event: UserAdminEvent
    actor_name: str | None


def get_user(session: Session, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise not_found(f"There is no user {user_id}.")
    return user


def history(session: Session, user_id: str) -> list[HistoryEntry]:
    """The user's admin action log, newest first."""
    actor = aliased(User)
    rows = session.execute(
        select(UserAdminEvent, actor.display_name)
        .outerjoin(actor, actor.id == UserAdminEvent.actor_id)
        .where(UserAdminEvent.target_user_id == user_id)
        .order_by(UserAdminEvent.occurred_at.desc(), UserAdminEvent.event_id)
    ).all()
    return [HistoryEntry(event=event, actor_name=name) for event, name in rows]


def open_review_count(session: Session, user_id: str) -> int:
    return session.scalar(
        select(func.count())
        .select_from(Note)
        .where(
            Note.assigned_reviewer_id == user_id,
            Note.status.in_(OPEN_REVIEW_STATUSES),
        )
    )


# --- Changing ---------------------------------------------------------------


def create(
    session: Session,
    *,
    actor: User,
    username: str,
    display_name: str,
    role: UserRole,
    now: datetime,
    settings: Settings,
) -> tuple[User, setup_links.IssuedLink]:
    """A new account without a password, and the link to choose one."""
    try:
        user = create_user(
            session,
            username=username,
            display_name=display_name,
            role=role,
            password=None,
            actor_id=actor.id,
            now=now,
        )
    except AccountError as error:
        raise _account_error(error) from error
    link = setup_links.issue(
        session,
        user=user,
        actor_id=actor.id,
        now=now,
        settings=settings,
    )
    return user, link


def update(
    session: Session,
    *,
    actor: User,
    user_id: str,
    username: str | None,
    display_name: str | None,
    role: UserRole | None,
    now: datetime,
) -> User:
    """Change a name, username or role; only what actually changes is logged."""
    # Administrators first, always in the same order (see _lock_admins).
    admins = _lock_admins(session) if role is not None else []
    user = _lock(session, user_id)
    try:
        new_username = normalize_username(username) if username is not None else None
        new_name = (
            check_display_name(display_name) if display_name is not None else None
        )
    except AccountError as error:
        raise _account_error(error) from error

    if new_username is not None and new_username != user.username:
        taken = session.scalar(
            select(User.id).where(User.username == new_username, User.id != user.id)
        )
        if taken:
            raise conflict(
                "username_taken",
                f"The username {new_username} is already taken.",
            )
        _log(
            session,
            actor,
            user,
            now,
            "RENAMED",
            "username",
            user.username,
            new_username,
        )
        user.username = new_username

    if new_name is not None and new_name != user.display_name:
        _log(
            session,
            actor,
            user,
            now,
            "RENAMED",
            "displayName",
            user.display_name,
            new_name,
        )
        user.display_name = new_name

    if role is not None and role != user.role:
        if user.id == actor.id:
            raise conflict("own_account", "You cannot change your own role.")
        if user.role == "ADMIN":
            _ensure_another_admin(admins, user)
        _log(session, actor, user, now, "ROLE_CHANGED", "role", user.role, role)
        user.role = role
        user.mfa_enabled = role in MFA_ROLES

    session.flush()
    return user


def deactivate(
    session: Session,
    *,
    actor: User,
    user_id: str,
    confirm_open_reviews: bool,
    now: datetime,
) -> User:
    """Turn an account off and end its sessions. Deactivating twice is a no-op."""
    admins = _lock_admins(session)
    user = _lock(session, user_id)
    if user.id == actor.id:
        raise conflict("own_account", "You cannot deactivate your own account.")
    if not user.is_active:
        return user
    if user.role == "ADMIN":
        _ensure_another_admin(admins, user)

    open_reviews = open_review_count(session, user.id)
    if open_reviews and not confirm_open_reviews:
        noun = "note" if open_reviews == 1 else "notes"
        raise conflict(
            "has_open_reviews",
            f"{user.display_name} has {open_reviews} {noun} waiting for or under "
            "their review. Confirm to deactivate anyway; the notes stay assigned "
            "until someone reassigns them.",
            openReviewCount=open_reviews,
        )

    user.is_active = False
    revoke_user_sessions(session, user.id, now)
    record_admin_event(
        session,
        action="DEACTIVATED",
        target_user_id=user.id,
        actor_id=actor.id,
        occurred_at=now,
        details={"openReviewCount": open_reviews},
    )
    session.flush()
    return user


def reactivate(session: Session, *, actor: User, user_id: str, now: datetime) -> User:
    user = _lock(session, user_id)
    if user.is_active:
        return user
    user.is_active = True
    record_admin_event(
        session,
        action="REACTIVATED",
        target_user_id=user.id,
        actor_id=actor.id,
        occurred_at=now,
    )
    session.flush()
    return user


def new_setup_link(
    session: Session,
    *,
    actor: User,
    user_id: str,
    now: datetime,
    settings: Settings,
) -> setup_links.IssuedLink:
    """A fresh link; for someone with a password it works as a reset."""
    user = _lock(session, user_id)
    if not user.is_active:
        raise conflict(
            "account_deactivated",
            "Reactivate the account before sending a setup link.",
        )
    return setup_links.issue(
        session,
        user=user,
        actor_id=actor.id,
        now=now,
        settings=settings,
    )


def _lock(session: Session, user_id: str) -> User:
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise not_found(f"There is no user {user_id}.")
    return user


def _lock_admins(session: Session) -> list[User]:
    """Lock the active administrators, in id order, before anything else.

    Two administrators removing each other at the same moment then cannot
    both succeed: the second waits, then sees the first change. Taking these
    locks first, in one order, means two such requests cannot deadlock.
    """
    return list(
        session.scalars(
            select(User)
            .where(User.role == "ADMIN", User.is_active.is_(True))
            .order_by(User.id)
            .with_for_update()
        )
    )


def _ensure_another_admin(admins: list[User], leaving: User) -> None:
    """Refuse if `leaving` is the last active administrator who can sign in."""
    others = [
        admin
        for admin in admins
        if admin.id != leaving.id and admin.password_hash is not None
    ]
    if not others:
        raise conflict(
            "last_admin",
            "This is the last active administrator. Make someone else an "
            "administrator first.",
        )


def _log(
    session: Session,
    actor: User,
    user: User,
    now: datetime,
    action: str,
    field: str,
    old: str,
    new: str,
) -> None:
    record_admin_event(
        session,
        action=action,
        target_user_id=user.id,
        actor_id=actor.id,
        occurred_at=now,
        details={"field": field, "from": old, "to": new},
    )
