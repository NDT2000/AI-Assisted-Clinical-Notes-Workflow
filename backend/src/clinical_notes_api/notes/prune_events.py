"""Remove old note events (`uv run clinical-notes-prune-events`).

Real-time clients catch up from the event log after a disconnection; events
older than EVENT_RETENTION_DAYS (30 by default) are no longer needed. A
client that was away longer reloads its notes instead. Safe to run at any
time, for example once a day; it also works in production.
"""

import argparse
import sys
from datetime import UTC, datetime, timedelta

from clinical_notes_api.config import get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory
from clinical_notes_api.notes.events import prune_events


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        prog="clinical-notes-prune-events",
        description="Remove note events older than the retention period.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=settings.event_retention_days,
        help=f"keep this many days (default {settings.event_retention_days})",
    )
    arguments = parser.parse_args(argv)

    if arguments.days < 1:
        print("Keep at least 1 day of events.", file=sys.stderr)
        return 1

    before = datetime.now(UTC) - timedelta(days=arguments.days)
    engine = create_db_engine(settings.database_url)
    try:
        with create_session_factory(engine).begin() as session:
            removed = prune_events(session, before)
    finally:
        engine.dispose()

    print(f"Removed {removed} events older than {arguments.days} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
