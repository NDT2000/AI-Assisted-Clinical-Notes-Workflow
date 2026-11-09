"""The open connections of one API process, and who follows which note."""

import asyncio
from collections import defaultdict
from collections.abc import Callable
from typing import Any

Deliver = Callable[[dict[str, Any]], None]


class ConnectionHub:
    """Hands each event to the connections following its note.

    Everything here runs on the process's event loop. Events arrive from
    other threads (requests commit in a worker thread) or from Redis; both
    go through `dispatch_threadsafe` or `dispatch`.
    """

    def __init__(self) -> None:
        self._followers: dict[str, set[Deliver]] = defaultdict(set)
        self._following: dict[Deliver, set[str]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def follow(self, deliver: Deliver, note_ids: set[str]) -> None:
        """Replace what this connection follows."""
        self.leave(deliver)
        self._following[deliver] = set(note_ids)
        for note_id in note_ids:
            self._followers[note_id].add(deliver)

    def leave(self, deliver: Deliver) -> None:
        for note_id in self._following.pop(deliver, set()):
            followers = self._followers.get(note_id)
            if followers is not None:
                followers.discard(deliver)
                if not followers:
                    del self._followers[note_id]

    def connection_count(self) -> int:
        return len(self._following)

    def dispatch(self, message: dict[str, Any]) -> None:
        """On the event loop: give the event to its note's followers."""
        for deliver in list(self._followers.get(message.get("noteId", ""), ())):
            deliver(message)

    def dispatch_threadsafe(self, message: dict[str, Any]) -> None:
        """From any thread. Dropped if no connection has started yet."""
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self.dispatch, message)
