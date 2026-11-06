"""Signing in, staying signed in, signing out, and the signed-in user.

Signing in returns a short-lived access token for the page to keep in memory,
and sets a renewal cookie that JavaScript cannot read. The cookie is sent
only to these endpoints and only from the application's own pages; the page
swaps it at /auth/refresh for a new access token (and a new cookie).
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from pydantic import BaseModel, Field

from clinical_notes_api.accounts import sessions, setup_links
from clinical_notes_api.accounts.schemas import (
    SetPasswordRequest,
    SetupLinkInfo,
    SetupLinkToken,
)
from clinical_notes_api.config import Settings
from clinical_notes_api.db import User
from clinical_notes_api.db.models import LOGIN_USERNAME_LENGTH
from clinical_notes_api.dependencies import (
    AppSettings,
    CurrentUser,
    DbSession,
    SessionFactory,
)
from clinical_notes_api.errors import ApiError, ErrorResponse, forbidden
from clinical_notes_api.security import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])

RENEWAL_COOKIE = "clinical_notes_renewal"
# The cookie goes only to the sign-in endpoints, never to the rest of the API.
RENEWAL_COOKIE_PATH = "/api/auth"


class LoginRequest(BaseModel):
    username: str = Field(
        min_length=1,
        max_length=LOGIN_USERNAME_LENGTH,
        examples=["reviewer-1"],
    )
    password: str = Field(min_length=1, max_length=256)


class UserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    mfa_verified: bool

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            mfa_verified=user.mfa_enabled,
        )


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - token type, not a secret
    expires_in: int = Field(description="Seconds until the token expires.")
    user: UserResponse


RenewalCookie = Annotated[str | None, Cookie(alias=RENEWAL_COOKIE)]


def require_own_origin(request: Request, settings: AppSettings) -> None:
    """Refuse requests a browser sends on behalf of another site.

    The cookie is already SameSite=Strict; this is a second check. Requests
    without an Origin header (not from a browser) cannot carry a victim's
    cookie, so they pass.
    """
    origin = request.headers.get("origin")
    if origin is None:
        return
    own_origin = f"{request.url.scheme}://{request.url.netloc}"
    if origin != own_origin and origin not in settings.cors_origins:
        raise forbidden("This request did not come from the application.")


OwnOrigin = Depends(require_own_origin)


def _client_address(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _set_renewal_cookie(
    response: Response,
    renewal: sessions.Renewal,
    settings: Settings,
    now: datetime,
) -> None:
    response.set_cookie(
        RENEWAL_COOKIE,
        renewal.token,
        max_age=max(0, int((renewal.expires_at - now).total_seconds())),
        # The database may hand back its own UTC zone; cookies need this one.
        expires=renewal.expires_at.astimezone(UTC),
        path=RENEWAL_COOKIE_PATH,
        secure=settings.secure_cookies,
        httponly=True,
        samesite="strict",
    )


def _clear_renewal_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        RENEWAL_COOKIE,
        path=RENEWAL_COOKIE_PATH,
        secure=settings.secure_cookies,
        httponly=True,
        samesite="strict",
    )


def _with_cleared_cookie(error: ApiError, settings: Settings) -> ApiError:
    """The error, plus a header that removes the browser's renewal cookie."""
    cleared = Response()
    _clear_renewal_cookie(cleared, settings)
    error.headers = {
        **(error.headers or {}),
        "Set-Cookie": cleared.headers["set-cookie"],
    }
    return error


def _token_response(
    signed_in: sessions.SignedIn,
    response: Response,
    settings: Settings,
    now: datetime,
) -> TokenResponse:
    user = signed_in.user
    token, expires_at = create_access_token(
        user_id=user.id,
        role=user.role,
        mfa_verified=user.mfa_enabled,
        settings=settings,
        now=now,
    )
    _set_renewal_cookie(response, signed_in.renewal, settings, now)
    return TokenResponse(
        access_token=token,
        expires_in=int((expires_at - now).total_seconds()),
        user=UserResponse.from_user(user),
    )


# These endpoints open their own transaction instead of using DbSession: a
# refused request must still keep what it recorded (a failed attempt, a
# revoked session), and DbSession rolls back when a request fails.


@router.post(
    "/login",
    dependencies=[OwnOrigin],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
)
def login(
    credentials: LoginRequest,
    request: Request,
    response: Response,
    session_factory: SessionFactory,
    settings: AppSettings,
) -> TokenResponse:
    """Exchange a username and password for an access token and a session."""
    now = datetime.now(UTC)
    with session_factory.begin() as session:
        outcome = sessions.sign_in(
            session,
            username=credentials.username,
            password=credentials.password,
            ip_address=_client_address(request),
            now=now,
            settings=settings,
        )
        if isinstance(outcome, sessions.SignedIn):
            body = _token_response(outcome, response, settings, now)
    if isinstance(outcome, ApiError):
        raise outcome
    return body


@router.post(
    "/refresh",
    dependencies=[OwnOrigin],
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def refresh(
    response: Response,
    session_factory: SessionFactory,
    settings: AppSettings,
    renewal_cookie: RenewalCookie = None,
) -> TokenResponse:
    """Swap the renewal cookie for a new access token and a new cookie.

    Each cookie works once. The session still ends at the time set when
    the user signed in.
    """
    now = datetime.now(UTC)
    with session_factory.begin() as session:
        outcome = sessions.renew(session, renewal_cookie, now)
        if isinstance(outcome, sessions.SignedIn):
            body = _token_response(outcome, response, settings, now)
    if isinstance(outcome, ApiError):
        raise _with_cleared_cookie(outcome, settings)
    return body


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OwnOrigin],
    responses={403: {"model": ErrorResponse}},
)
def logout(
    session_factory: SessionFactory,
    settings: AppSettings,
    renewal_cookie: RenewalCookie = None,
) -> Response:
    """End the session and remove the renewal cookie.

    Works without an access token, so a user whose token has expired can
    still sign out.
    """
    with session_factory.begin() as session:
        sessions.end_session(session, renewal_cookie, datetime.now(UTC))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_renewal_cookie(response, settings)
    return response


@router.post(
    "/setup-link",
    dependencies=[OwnOrigin],
    responses={400: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def check_setup_link(
    request: SetupLinkToken,
    session: DbSession,
) -> SetupLinkInfo:
    """Whose setup link this is, so the page can greet them before they choose
    a password."""
    found = setup_links.find(session, request.token, datetime.now(UTC))
    if found is None:
        raise setup_links.invalid_setup_link()
    link, user = found
    return SetupLinkInfo(
        username=user.username,
        display_name=user.display_name,
        expires_at=link.expires_at,
    )


@router.post(
    "/set-password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OwnOrigin],
    responses={400: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def set_password(request: SetPasswordRequest, session: DbSession) -> Response:
    """Choose a password with a setup link. The link then stops working, and
    the person is signed out everywhere; they sign in with the new password."""
    setup_links.set_password(
        session,
        request.token,
        request.password,
        datetime.now(UTC),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/me",
    responses={401: {"model": ErrorResponse}},
)
def read_current_user(user: CurrentUser) -> UserResponse:
    """The user the access token belongs to."""
    return UserResponse.from_user(user)
