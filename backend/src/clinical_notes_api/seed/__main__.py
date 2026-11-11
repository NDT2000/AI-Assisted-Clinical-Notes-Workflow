"""Seed the database with synthetic notes and users.

uv run clinical-notes-seed            # 5,000 notes into an empty database
uv run clinical-notes-seed --reset    # empty every table first
uv run clinical-notes-seed --if-empty # seed only an empty database (Compose)

Every user gets their own random password; the passwords are written to
credentials.local.md at the repository root (git-ignored).
"""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from clinical_notes_api.config import get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory
from clinical_notes_api.seed.credentials import CREDENTIALS_PATH, write_credentials
from clinical_notes_api.seed.load import SeedError, seed_database


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clinical-notes-seed",
        description="Load synthetic notes that match the frontend's mock data.",
    )
    parser.add_argument("--count", type=int, default=5_000, help="number of notes")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    already_there = parser.add_mutually_exclusive_group()
    already_there.add_argument(
        "--reset",
        action="store_true",
        help="delete all existing data first",
    )
    already_there.add_argument(
        "--if-empty",
        action="store_true",
        help=(
            "seed only an empty database; otherwise leave it, and its "
            "passwords, as they are and succeed"
        ),
    )
    parser.add_argument(
        "--credentials-file",
        type=Path,
        default=CREDENTIALS_PATH,
        help="where to write the users' passwords (default: %(default)s)",
    )
    arguments = parser.parse_args(argv)

    settings = get_settings()
    if settings.environment == "production":
        print("Refusing to seed synthetic data in production.", file=sys.stderr)
        return 1

    engine = create_db_engine(settings.database_url)
    session_factory = create_session_factory(engine)

    try:
        with session_factory.begin() as session:
            result = seed_database(
                session,
                count=arguments.count,
                seed=arguments.seed,
                reset=arguments.reset,
            )
            # Before the commit: if the file cannot be written, nothing is
            # seeded, so no user is left with a password nobody knows.
            write_credentials(
                arguments.credentials_file,
                result.credentials,
                datetime.now(UTC),
            )
    except SeedError as error:
        if arguments.if_empty:
            print(f"{error} Nothing was seeded; existing passwords still apply.")
            return 0
        print(f"{error} Use --reset to replace the existing data.", file=sys.stderr)
        return 1
    except OSError as error:
        print(
            f"Could not write {arguments.credentials_file}: {error}. "
            "Nothing was seeded.",
            file=sys.stderr,
        )
        return 1
    finally:
        engine.dispose()

    print(
        f"Seeded {result.notes} notes, {result.versions} versions, "
        f"{result.events} review events, {result.patients} patients "
        f"and {result.users} users."
    )
    print(f"Passwords written to {arguments.credentials_file} (never commit it).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
