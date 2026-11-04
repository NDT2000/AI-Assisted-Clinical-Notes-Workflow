"""Signing in and reading the signed-in user."""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from clinical_notes_api.db import User
from clinical_notes_api.dependencies import AppSettings, CurrentUser, DbSession
from clinical_notes_api.errors import ErrorResponse, unauthenticated
from clinical_notes_api.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_CREDENTIALS = "The username or password is incorrect."


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64, examples=["reviewer-1"])
    password: str = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    id: str
    display_name: str
    role: str
    mfa_verified: bool

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(
            id=user.id,
            display_name=user.display_name,
            role=user.role,
            mfa_verified=user.mfa_enabled,
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - token type, not a secret
    expires_in: int = Field(description="Seconds until the token expires.")
    user: UserResponse


@router.post(
    "/login",
    responses={401: {"model": ErrorResponse}},
)
def login(
    credentials: LoginRequest,
    session: DbSession,
    settings: AppSettings,
) -> TokenResponse:
    """Exchange a username and password for an access token."""
    user = session.scalar(select(User).where(User.id == credentials.username))

    # Same error, and the same hashing work, for an unknown user and a wrong
    # password, so a response does not reveal which usernames exist.
    password_hash = user.password_hash if user is not None else None
    if not verify_password(credentials.password, password_hash) or user is None:
        raise unauthenticated(INVALID_CREDENTIALS)

    now = datetime.now(UTC)
    token, expires_at = create_access_token(
        user_id=user.id,
        role=user.role,
        mfa_verified=user.mfa_enabled,
        settings=settings,
        now=now,
    )

    return TokenResponse(
        access_token=token,
        expires_in=int((expires_at - now).total_seconds()),
        user=UserResponse.from_user(user),
    )


@router.get(
    "/me",
    responses={401: {"model": ErrorResponse}},
)
def read_current_user(user: CurrentUser) -> UserResponse:
    """The user the access token belongs to."""
    return UserResponse.from_user(user)
