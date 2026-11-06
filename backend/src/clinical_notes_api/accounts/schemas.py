"""Request and response bodies for the account endpoints (camelCase JSON)."""

from typing import Any, Literal

from pydantic import Field, model_validator

from clinical_notes_api.accounts.users import MAX_DISPLAY_NAME_LENGTH
from clinical_notes_api.db import User, UserAdminEvent
from clinical_notes_api.db.models import (
    LOGIN_USERNAME_LENGTH,
    UserAdminAction,
    UserRole,
)
from clinical_notes_api.notes.schemas import ApiModel, Timestamp

AccountStatus = Literal["ACTIVE", "SETUP_PENDING", "DEACTIVATED"]


def account_status(user: User) -> AccountStatus:
    if not user.is_active:
        return "DEACTIVATED"
    if user.password_hash is None:
        return "SETUP_PENDING"
    return "ACTIVE"


class UserAccount(ApiModel):
    id: str
    username: str
    display_name: str
    role: UserRole
    status: AccountStatus = Field(
        description="SETUP_PENDING: active, but no password chosen yet.",
    )
    mfa_enabled: bool
    created_at: Timestamp
    created_by_id: str | None
    last_login_at: Timestamp | None

    @classmethod
    def from_user(cls, user: User) -> "UserAccount":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            status=account_status(user),
            mfa_enabled=user.mfa_enabled,
            created_at=user.created_at,
            created_by_id=user.created_by_id,
            last_login_at=user.last_login_at,
        )


class UserListResponse(ApiModel):
    users: list[UserAccount]


class AdminEvent(ApiModel):
    event_id: str
    action: UserAdminAction
    actor_id: str | None = Field(description="Null when a command made the change.")
    actor_name: str | None
    details: dict[str, Any]
    occurred_at: Timestamp

    @classmethod
    def from_event(cls, event: UserAdminEvent, actor_name: str | None) -> "AdminEvent":
        return cls(
            event_id=event.event_id,
            action=event.action,
            actor_id=event.actor_id,
            actor_name=actor_name,
            details=event.details,
            occurred_at=event.occurred_at,
        )


class UserDetailResponse(ApiModel):
    user: UserAccount
    setup_link_expires_at: Timestamp | None = Field(
        description="When the user's unused setup link expires, if they have one.",
    )
    open_review_count: int = Field(
        description="Notes waiting for, or under, this user's review.",
    )
    history: list[AdminEvent] = Field(description="Newest first.")


class SetupLink(ApiModel):
    url: str = Field(description="Shown once; only a hash is stored.")
    expires_at: Timestamp


class CreateUserRequest(ApiModel):
    username: str = Field(min_length=1, max_length=LOGIN_USERNAME_LENGTH)
    display_name: str = Field(min_length=1, max_length=MAX_DISPLAY_NAME_LENGTH)
    role: UserRole


class CreatedUserResponse(ApiModel):
    user: UserAccount
    setup_link: SetupLink


class UpdateUserRequest(ApiModel):
    username: str | None = Field(default=None, max_length=LOGIN_USERNAME_LENGTH)
    display_name: str | None = Field(
        default=None,
        max_length=MAX_DISPLAY_NAME_LENGTH,
    )
    role: UserRole | None = None

    @model_validator(mode="after")
    def change_something(self) -> "UpdateUserRequest":
        if self.username is None and self.display_name is None and self.role is None:
            raise ValueError("Give a username, displayName or role to change.")
        return self


class DeactivateRequest(ApiModel):
    confirm_open_reviews: bool = Field(
        default=False,
        description=(
            "Deactivate even though notes wait for this reviewer; they stay "
            "assigned until someone reassigns them."
        ),
    )


class DirectoryEntry(ApiModel):
    id: str
    display_name: str
    role: UserRole


class DirectoryResponse(ApiModel):
    users: list[DirectoryEntry]


# --- Setup links (used by the person, not the administrator) ----------------


class SetupLinkToken(ApiModel):
    token: str = Field(min_length=1, max_length=256)


class SetupLinkInfo(ApiModel):
    username: str
    display_name: str
    expires_at: Timestamp


class SetPasswordRequest(ApiModel):
    token: str = Field(min_length=1, max_length=256)
    password: str = Field(min_length=1, max_length=256)
