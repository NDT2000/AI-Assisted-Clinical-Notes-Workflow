import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import Request
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/clinical_notes_api/config.py -> repository root
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

# Only for local development; production must set its own JWT_SECRET.
DEVELOPMENT_JWT_SECRET = "development-only-secret-do-not-use-in-production"  # noqa: S105
MINIMUM_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """Configuration read from environment variables.

    Values come from the process environment first, then from the
    repository-root .env file shared with Docker Compose.
    """

    model_config = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"

    database_url: str = Field(
        default="postgresql+psycopg://clinical:clinical@localhost:5433/clinical_notes",
        description="SQLAlchemy URL for the Postgres database.",
    )

    cors_origins: list[str] = Field(
        default=["http://localhost:5173"],
        description="Browser origins allowed to call the API (the Vite dev server).",
    )

    jwt_secret: SecretStr = Field(
        default=SecretStr(DEVELOPMENT_JWT_SECRET),
        description="Key that signs access tokens.",
    )

    access_token_minutes: int = Field(
        default=15,
        gt=0,
        description="How long an access token stays valid.",
    )

    session_hours: int = Field(
        default=12,
        gt=0,
        description=(
            "How long a sign-in lasts, however often it is renewed; then the "
            "user signs in again."
        ),
    )

    login_failure_limit: int = Field(
        default=5,
        gt=0,
        description="Failed sign-ins for one username before it is locked.",
    )

    login_ip_failure_limit: int = Field(
        default=20,
        gt=0,
        description="Failed sign-ins from one address before it is locked.",
    )

    login_lockout_minutes: int = Field(
        default=15,
        gt=0,
        description="The window failed sign-ins are counted in, and the lockout.",
    )

    app_base_url: str = Field(
        default="http://localhost:5173",
        description="Where people open the application; setup links point here.",
    )

    setup_link_hours: int = Field(
        default=72,
        gt=0,
        description="How long a new user's setup link stays valid.",
    )

    event_retention_days: int = Field(
        default=30,
        gt=0,
        description="How long the note event log keeps events for catching up.",
    )

    redis_url: str | None = Field(
        default=None,
        description=(
            "Redis that relays note events between API processes. Without "
            "it, events reach only connections to the same process."
        ),
    )

    presence_ttl_seconds: int = Field(
        default=30,
        gt=0,
        description=(
            "How long someone stays shown on a note after their browser stops "
            "saying it is still there."
        ),
    )

    api_host: str = Field(
        default="127.0.0.1",
        description=(
            "Address `clinical-notes-serve` listens on; 0.0.0.0 in a container."
        ),
    )

    api_port: int = Field(
        default=8000,
        gt=0,
        lt=65_536,
        description="Port `clinical-notes-serve` listens on.",
    )

    forwarded_allow_ips: str = Field(
        default="127.0.0.1",
        description=(
            "Comma-separated proxy addresses or networks (such as nginx) whose "
            "X-Forwarded-For header is believed. Sign-in lockouts count "
            "failures per visitor address, so behind a proxy this must name "
            "the proxy, or every visitor looks like the proxy."
        ),
    )

    @field_validator("forwarded_allow_ips")
    @classmethod
    def proxies_are_addresses_or_networks(cls, value: str) -> str:
        entries = [entry.strip() for entry in value.split(",") if entry.strip()]
        if not entries:
            raise ValueError("FORWARDED_ALLOW_IPS needs at least one address.")
        for entry in entries:
            if entry == "*":
                raise ValueError(
                    "FORWARDED_ALLOW_IPS must name the proxy, not '*': anyone "
                    "could then fake their address and dodge sign-in lockouts."
                )
            try:
                ipaddress.ip_network(entry)
            except ValueError as error:
                raise ValueError(
                    f"FORWARDED_ALLOW_IPS entry {entry!r} is not an address or network."
                ) from error
        return ",".join(entries)

    @property
    def secure_cookies(self) -> bool:
        """Cookies only over HTTPS in production; local development is HTTP."""
        return self.environment == "production"

    @model_validator(mode="after")
    def require_a_real_secret_in_production(self) -> "Settings":
        if self.environment != "production":
            return self

        secret = self.jwt_secret.get_secret_value()
        if secret == DEVELOPMENT_JWT_SECRET:
            raise ValueError("Set JWT_SECRET in production.")
        if len(secret) < MINIMUM_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {MINIMUM_JWT_SECRET_LENGTH} characters."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Settings from the environment, read once per process."""
    return Settings()


def get_app_settings(request: Request) -> Settings:
    """Route dependency: the settings this app instance was created with."""
    return request.app.state.settings
