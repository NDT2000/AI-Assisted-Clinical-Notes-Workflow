"""Password hashing and access tokens."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from clinical_notes_api.config import Settings

ALGORITHM = "HS256"
ISSUER = "clinical-notes-api"

_password_hasher = PasswordHash.recommended()

# Checked when the user does not exist, so a login takes the same time
# whether or not the username is valid.
_UNUSED_HASH = _password_hasher.hash("password-for-unknown-users")


class InvalidTokenError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    role: str
    mfa_verified: bool
    expires_at: datetime


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _password_hasher.verify(password, _UNUSED_HASH)
        return False
    return _password_hasher.verify(password, password_hash)


def create_access_token(
    *,
    user_id: str,
    role: str,
    mfa_verified: bool,
    settings: Settings,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.access_token_minutes)
    payload: dict[str, Any] = {
        "iss": ISSUER,
        "sub": user_id,
        "role": role,
        "mfa": mfa_verified,
        "iat": issued_at,
        "exp": expires_at,
    }
    token = jwt.encode(
        payload,
        settings.jwt_secret.get_secret_value(),
        algorithm=ALGORITHM,
    )
    return token, expires_at


def decode_access_token(token: str, settings: Settings) -> TokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise InvalidTokenError(str(error)) from error

    return TokenClaims(
        user_id=payload["sub"],
        role=payload.get("role", ""),
        mfa_verified=bool(payload.get("mfa", False)),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=UTC),
    )
