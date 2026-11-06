"""Account routes: the administrator's user management, and the directory.

Everything under /users is for administrators, except /users/directory,
which any signed-in user may read to choose someone (such as a reviewer).
"""

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, status

from clinical_notes_api.accounts import admin, schemas, setup_links
from clinical_notes_api.db.models import UserRole
from clinical_notes_api.dependencies import AppSettings, CurrentUser, DbSession
from clinical_notes_api.errors import ErrorResponse

router = APIRouter(prefix="/users", tags=["users"])


def _errors(*codes: int) -> dict[int | str, dict[str, Any]]:
    return {code: {"model": ErrorResponse} for code in (400, 401, 403, *codes)}


def _detail(session: DbSession, user_id: str) -> schemas.UserDetailResponse:
    user = admin.get_user(session, user_id)
    return schemas.UserDetailResponse(
        user=schemas.UserAccount.from_user(user),
        setup_link_expires_at=setup_links.pending_link_expiry(
            session, user.id, datetime.now(UTC)
        ),
        open_review_count=admin.open_review_count(session, user.id),
        history=[
            schemas.AdminEvent.from_event(entry.event, entry.actor_name)
            for entry in admin.history(session, user.id)
        ],
    )


def _link(link: setup_links.IssuedLink) -> schemas.SetupLink:
    return schemas.SetupLink(url=link.url, expires_at=link.expires_at)


# Declared before /users/{user_id}, so "directory" is not taken for an id.
@router.get("/directory", responses=_errors())
def read_directory(
    _user: CurrentUser,
    session: DbSession,
    role: UserRole | None = None,
) -> schemas.DirectoryResponse:
    """Active people with their name and role, for any signed-in user."""
    return schemas.DirectoryResponse(
        users=[
            schemas.DirectoryEntry(
                id=user.id, display_name=user.display_name, role=user.role
            )
            for user in admin.directory(session, role)
        ]
    )


@router.get("", responses=_errors())
def list_users(
    user: CurrentUser,
    session: DbSession,
    role: UserRole | None = None,
    active: bool | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
) -> schemas.UserListResponse:
    """Every account, including deactivated ones, by name."""
    admin.require_admin(user)
    return schemas.UserListResponse(
        users=[
            schemas.UserAccount.from_user(account)
            for account in admin.list_users(session, role=role, active=active, search=q)
        ]
    )


@router.post("", status_code=status.HTTP_201_CREATED, responses=_errors(409))
def create_user(
    request: schemas.CreateUserRequest,
    user: CurrentUser,
    session: DbSession,
    settings: AppSettings,
) -> schemas.CreatedUserResponse:
    """Create an account without a password, and its one-time setup link."""
    admin.require_admin(user)
    created, link = admin.create(
        session,
        actor=user,
        username=request.username,
        display_name=request.display_name,
        role=request.role,
        now=datetime.now(UTC),
        settings=settings,
    )
    return schemas.CreatedUserResponse(
        user=schemas.UserAccount.from_user(created),
        setup_link=_link(link),
    )


@router.get("/{user_id}", responses=_errors(404))
def read_user(
    user_id: str,
    user: CurrentUser,
    session: DbSession,
) -> schemas.UserDetailResponse:
    """One account, its open reviews and its admin action log."""
    admin.require_admin(user)
    return _detail(session, user_id)


@router.patch("/{user_id}", responses=_errors(404, 409))
def update_user(
    user_id: str,
    request: schemas.UpdateUserRequest,
    user: CurrentUser,
    session: DbSession,
) -> schemas.UserDetailResponse:
    """Change the name, username or role."""
    admin.require_admin(user)
    admin.update(
        session,
        actor=user,
        user_id=user_id,
        username=request.username,
        display_name=request.display_name,
        role=request.role,
        now=datetime.now(UTC),
    )
    return _detail(session, user_id)


@router.post("/{user_id}/deactivate", responses=_errors(404, 409))
def deactivate_user(
    user_id: str,
    user: CurrentUser,
    session: DbSession,
    request: schemas.DeactivateRequest | None = None,
) -> schemas.UserDetailResponse:
    """Turn the account off and end its sessions."""
    admin.require_admin(user)
    admin.deactivate(
        session,
        actor=user,
        user_id=user_id,
        confirm_open_reviews=request is not None and request.confirm_open_reviews,
        now=datetime.now(UTC),
    )
    return _detail(session, user_id)


@router.post("/{user_id}/reactivate", responses=_errors(404))
def reactivate_user(
    user_id: str,
    user: CurrentUser,
    session: DbSession,
) -> schemas.UserDetailResponse:
    """Turn the account back on."""
    admin.require_admin(user)
    admin.reactivate(session, actor=user, user_id=user_id, now=datetime.now(UTC))
    return _detail(session, user_id)


@router.post(
    "/{user_id}/setup-link",
    status_code=status.HTTP_201_CREATED,
    responses=_errors(404, 409),
)
def issue_setup_link(
    user_id: str,
    user: CurrentUser,
    session: DbSession,
    settings: AppSettings,
) -> schemas.SetupLink:
    """A new setup link; earlier unused ones stop working.

    For someone who already has a password, this is a password reset: the
    old password works until the link is used.
    """
    admin.require_admin(user)
    return _link(
        admin.new_setup_link(
            session,
            actor=user,
            user_id=user_id,
            now=datetime.now(UTC),
            settings=settings,
        )
    )
