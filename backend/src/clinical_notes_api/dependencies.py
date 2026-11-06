"""Shared route dependencies: database sessions and the signed-in user."""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session, sessionmaker

from clinical_notes_api.config import Settings, get_app_settings
from clinical_notes_api.db import User
from clinical_notes_api.errors import unauthenticated
from clinical_notes_api.security import InvalidTokenError, decode_access_token
from clinical_notes_api.workflow import Actor

# auto_error=False so a missing token gets our error shape, not FastAPI's.
_bearer = HTTPBearer(auto_error=False)


def get_db_session(request: Request) -> Iterator[Session]:
    """A session per request: committed on success, rolled back on error."""
    with request.app.state.session_factory.begin() as session:
        yield session


DbSession = Annotated[Session, Depends(get_db_session)]


def get_session_factory(request: Request) -> sessionmaker[Session]:
    """For endpoints that commit on their own, even when they refuse."""
    return request.app.state.session_factory


SessionFactory = Annotated[sessionmaker[Session], Depends(get_session_factory)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: DbSession,
    settings: AppSettings,
) -> User:
    """The user the bearer token was issued to.

    The user is re-read from the database on every request, so a removed or
    deactivated user loses access at once and role changes apply
    immediately.
    """
    if credentials is None:
        raise unauthenticated()

    try:
        claims = decode_access_token(credentials.credentials, settings)
    except InvalidTokenError as error:
        raise unauthenticated("Your session is invalid or has expired.") from error

    user = session.get(User, claims.user_id)
    if user is None or not user.is_active or user.password_hash is None:
        raise unauthenticated("Your session is invalid or has expired.")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_actor(user: CurrentUser) -> Actor:
    """The signed-in user, as the workflow rules see them."""
    return Actor(id=user.id, role=user.role, mfa_verified=user.mfa_enabled)


CurrentActor = Annotated[Actor, Depends(get_current_actor)]
