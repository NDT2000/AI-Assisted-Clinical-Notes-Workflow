"""Fixtures for tests that need a real Postgres database.

They create a throwaway `<name>_test` database next to the configured one,
migrate it to the latest schema, and drop it afterwards. Without a
reachable server those tests are skipped, so the rest still run.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from clinical_notes_api.config import Settings
from clinical_notes_api.db.session import create_session_factory

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def alembic_config(database_url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    config.set_main_option(
        "sqlalchemy.url",
        # Alembic's config treats % as interpolation.
        database_url.replace("%", "%%"),
    )
    return config


@pytest.fixture(scope="session")
def test_database_url() -> Iterator[str]:
    configured = make_url(Settings().database_url)
    test_url = configured.set(database=f"{configured.database}_test")
    server_url = configured.set(database="postgres")

    server = create_engine(server_url, isolation_level="AUTOCOMMIT")
    try:
        with server.connect() as connection:
            connection.execute(
                text(f'DROP DATABASE IF EXISTS "{test_url.database}" WITH (FORCE)')
            )
            connection.execute(text(f'CREATE DATABASE "{test_url.database}"'))
    except OperationalError as error:
        server.dispose()
        pytest.skip(f"Postgres is not reachable: {error.orig}")

    url = test_url.render_as_string(hide_password=False)
    command.upgrade(alembic_config(url), "head")

    yield url

    with server.connect() as connection:
        connection.execute(
            text(f'DROP DATABASE IF EXISTS "{test_url.database}" WITH (FORCE)')
        )
    server.dispose()


@pytest.fixture(scope="session")
def engine(test_database_url: str) -> Iterator[Engine]:
    engine = create_engine(test_database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    """A session whose changes are rolled back after each test."""
    session = create_session_factory(engine)()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
