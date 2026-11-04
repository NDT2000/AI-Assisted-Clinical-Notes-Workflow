"""Seed the database with synthetic notes.

uv run clinical-notes-seed            # 5,000 notes into an empty database
uv run clinical-notes-seed --reset    # empty every table first
"""

import argparse
import sys

from clinical_notes_api.config import get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory
from clinical_notes_api.seed.load import SeedError, seed_database


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="clinical-notes-seed",
        description="Load synthetic notes that match the frontend's mock data.",
    )
    parser.add_argument("--count", type=int, default=5_000, help="number of notes")
    parser.add_argument("--seed", type=int, default=42, help="random seed")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="delete all existing data first",
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
                demo_password=settings.demo_user_password.get_secret_value(),
            )
    except SeedError as error:
        print(f"{error} Use --reset to replace the existing data.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print(
        f"Seeded {result.notes} notes, {result.versions} versions, "
        f"{result.events} review events, {result.patients} patients "
        f"and {result.users} users."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
