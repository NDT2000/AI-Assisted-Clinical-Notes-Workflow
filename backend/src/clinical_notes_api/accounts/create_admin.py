"""Create an administrator account (`uv run clinical-notes-create-admin`).

This is how a real installation gets its first administrator: there is no
default admin password anywhere. It asks for the password twice and never
echoes it. Unlike the seed, it also works in production.
"""

import argparse
import getpass
import sys
from collections.abc import Callable
from datetime import UTC, datetime

from clinical_notes_api.accounts.users import (
    MIN_PASSWORD_LENGTH,
    AccountError,
    check_display_name,
    check_password,
    create_user,
    normalize_username,
)
from clinical_notes_api.config import get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory


def main(
    argv: list[str] | None = None,
    *,
    ask: Callable[[str], str] = input,
    ask_secret: Callable[[str], str] = getpass.getpass,
) -> int:
    parser = argparse.ArgumentParser(
        prog="clinical-notes-create-admin",
        description="Create an administrator account.",
    )
    parser.add_argument("--username", help="sign-in name (asked for if left out)")
    parser.add_argument("--name", help="the person's full name (asked for if left out)")
    arguments = parser.parse_args(argv)

    try:
        # Checked before the password is asked for, so a typo fails fast.
        username = normalize_username(arguments.username or ask("Username: "))
        name = check_display_name(arguments.name or ask("Full name: "))
        password = ask_secret(f"Password (at least {MIN_PASSWORD_LENGTH} characters): ")
        check_password(password)
        if ask_secret("Repeat the password: ") != password:
            raise AccountError("The passwords do not match.")
    except AccountError as error:
        print(error, file=sys.stderr)
        return 1

    engine = create_db_engine(get_settings().database_url)
    try:
        with create_session_factory(engine).begin() as session:
            create_user(
                session,
                username=username,
                display_name=name,
                role="ADMIN",
                password=password,
                actor_id=None,
                now=datetime.now(UTC),
            )
    except AccountError as error:
        print(error, file=sys.stderr)
        return 1
    finally:
        engine.dispose()

    print(f"Created administrator {username}. Sign in with that username.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
