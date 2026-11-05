"""Fixtures for tests that need a real Postgres database.

They create a throwaway `<name>_test` database next to the configured one,
migrate it to the latest schema, and drop it afterwards. Without a
reachable server those tests are skipped, so the rest still run; with
REQUIRE_DATABASE=1 (as in CI) they fail instead.

The note API fixtures at the end seed 60 notes per module and run each test
inside a transaction that is rolled back. test_auth.py and test_database.py
define their own `settings`, `app`, `client` and `seeded`, which take
precedence there.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Connection, Engine, create_engine, make_url, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from clinical_notes_api.config import Settings
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.main import create_app
from clinical_notes_api.seed.load import clear_all, seed_database
from tests.note_api import NOTE_COUNT, PASSWORD, SEED, auth

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
        message = f"Postgres is not reachable: {error.orig}"
        # CI sets REQUIRE_DATABASE=1, so a missing database fails the run
        # instead of quietly skipping every database test.
        if os.environ.get("REQUIRE_DATABASE") == "1":
            pytest.fail(message, pytrace=False)
        pytest.skip(message)

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


# --- Note API fixtures -------------------------------------------------------


@pytest.fixture(scope="module")
def settings(test_database_url: str) -> Settings:
    return Settings(
        _env_file=None,
        environment="test",
        database_url=test_database_url,
        jwt_secret=SecretStr("test-secret-that-is-long-enough-for-hs256"),
    )


@pytest.fixture(scope="module")
def seeded_notes(engine: Engine) -> Iterator[None]:
    """60 synthetic notes and the demo users, for one test module."""
    with create_session_factory(engine).begin() as session:
        seed_database(
            session,
            count=NOTE_COUNT,
            seed=SEED,
            reset=True,
            demo_password=PASSWORD,
        )
    yield
    with create_session_factory(engine).begin() as session:
        clear_all(session)


@pytest.fixture
def connection(engine: Engine, seeded_notes: None) -> Iterator[Connection]:
    """One connection in an outer transaction that is always rolled back."""
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


@pytest.fixture
def app(settings: Settings, connection: Connection) -> FastAPI:
    app = create_app(settings)
    # Each request's commit becomes a savepoint inside the outer transaction.
    app.state.session_factory = sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    return app


@pytest.fixture
def db(connection: Connection) -> Iterator[Session]:
    """For checking what the API wrote."""
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        yield session


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def as_user(settings: Settings):
    """Authorization headers for a seeded user: as_user("reviewer-1")."""
    return lambda user_id: auth(user_id, settings)
