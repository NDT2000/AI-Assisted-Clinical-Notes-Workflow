"""Who has a note open right now ("presence"), shared by every API process.

Each live connection may have one note open. It announces itself (viewing
or editing) and repeats the announcement while it stays; an entry that is
not repeated within the time to live disappears on its own, so a closed tab
or a lost network leaves nothing behind. Closing the note or the connection
removes the entry at once.

With Redis, entries live there, so every process sees the same people:
one hash of entries and one sorted set of expiry times per note. Without
Redis, they live in this process's memory.
"""

import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol

import anyio
import anyio.to_thread
import redis.asyncio as redis_async

from clinical_notes_api.notes.schemas import to_iso

Activity = Literal["VIEWING", "EDITING"]
ACTIVITIES: tuple[str, ...] = ("VIEWING", "EDITING")

KEY_PREFIX = "clinical-notes:presence"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PresenceEntry:
    connection_id: str
    user_id: str
    display_name: str
    role: str
    activity: Activity
    last_seen_ms: int


def now_ms() -> int:
    return int(time.time() * 1000)


class PresenceStore(Protocol):
    async def set(self, note_id: str, entry: PresenceEntry, ttl_ms: int) -> bool:
        """Add or refresh an entry; True when something others see changed."""

    async def remove(self, note_id: str, connection_id: str) -> bool:
        """Remove an entry; True when it was there."""

    async def entries(self, note_id: str) -> list[PresenceEntry]:
        """The note's unexpired entries (expired ones are dropped)."""

    async def close(self) -> None: ...


class MemoryPresenceStore:
    """For one process without Redis."""

    def __init__(self) -> None:
        self._notes: dict[str, dict[str, tuple[PresenceEntry, int]]] = {}

    async def set(self, note_id: str, entry: PresenceEntry, ttl_ms: int) -> bool:
        entries = self._notes.setdefault(note_id, {})
        previous = entries.get(entry.connection_id)
        entries[entry.connection_id] = (entry, entry.last_seen_ms + ttl_ms)
        return previous is None or previous[0].activity != entry.activity

    async def remove(self, note_id: str, connection_id: str) -> bool:
        entries = self._notes.get(note_id, {})
        removed = entries.pop(connection_id, None) is not None
        if not entries:
            self._notes.pop(note_id, None)
        return removed

    async def entries(self, note_id: str) -> list[PresenceEntry]:
        entries = self._notes.get(note_id, {})
        current = now_ms()
        for connection_id in [
            key for key, (_, expires) in entries.items() if expires <= current
        ]:
            del entries[connection_id]
        return [entry for entry, _ in entries.values()]

    async def close(self) -> None:
        pass


class RedisPresenceStore:
    """Shared by every process through Redis."""

    def __init__(self, url: str) -> None:
        self._redis = redis_async.Redis.from_url(url, decode_responses=True)

    @staticmethod
    def _keys(note_id: str) -> tuple[str, str]:
        return f"{KEY_PREFIX}:{note_id}", f"{KEY_PREFIX}-expiry:{note_id}"

    async def set(self, note_id: str, entry: PresenceEntry, ttl_ms: int) -> bool:
        entries_key, expiry_key = self._keys(note_id)
        previous = await self._redis.hget(entries_key, entry.connection_id)
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(entries_key, entry.connection_id, json.dumps(asdict(entry)))
            pipe.zadd(expiry_key, {entry.connection_id: entry.last_seen_ms + ttl_ms})
            # The keys themselves go once nobody is left to refresh them.
            pipe.pexpire(entries_key, ttl_ms * 2)
            pipe.pexpire(expiry_key, ttl_ms * 2)
            await pipe.execute()
        return previous is None or json.loads(previous)["activity"] != entry.activity

    async def remove(self, note_id: str, connection_id: str) -> bool:
        entries_key, expiry_key = self._keys(note_id)
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.hdel(entries_key, connection_id)
            pipe.zrem(expiry_key, connection_id)
            removed, _ = await pipe.execute()
        return bool(removed)

    async def entries(self, note_id: str) -> list[PresenceEntry]:
        entries_key, expiry_key = self._keys(note_id)
        expired = await self._redis.zrangebyscore(expiry_key, "-inf", now_ms())
        if expired:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.hdel(entries_key, *expired)
                pipe.zrem(expiry_key, *expired)
                await pipe.execute()
        raw = await self._redis.hgetall(entries_key)
        return [PresenceEntry(**json.loads(value)) for value in raw.values()]

    async def close(self) -> None:
        await self._redis.aclose()


def create_presence_store(redis_url: str | None) -> PresenceStore:
    return RedisPresenceStore(redis_url) if redis_url else MemoryPresenceStore()


def presence_message(note_id: str, entries: list[PresenceEntry]) -> dict[str, Any]:
    """The note's presence as a real-time event (the frontend's shape).

    One entry per person: several tabs of one user count once, and editing
    wins over viewing. Editors come first, then by name.
    """
    by_user: dict[str, PresenceEntry] = {}
    for entry in entries:
        current = by_user.get(entry.user_id)
        if (
            current is None
            or (entry.activity == "EDITING" and current.activity != "EDITING")
            or (
                entry.activity == current.activity
                and entry.last_seen_ms > current.last_seen_ms
            )
        ):
            by_user[entry.user_id] = entry

    people = sorted(
        by_user.values(),
        key=lambda entry: (entry.activity != "EDITING", entry.display_name),
    )
    return {
        "type": "note.presence_changed",
        "eventId": f"presence-{uuid.uuid4()}",
        # Presence is not part of the event log: it never moves a cursor.
        "cursor": 0,
        "noteId": note_id,
        "occurredAt": to_iso(datetime.now(UTC)),
        "presence": [
            {
                "user": {
                    "id": entry.user_id,
                    "displayName": entry.display_name,
                    "role": entry.role,
                },
                "activity": entry.activity,
                "lastSeenAt": to_iso(
                    datetime.fromtimestamp(entry.last_seen_ms / 1000, UTC)
                ),
            }
            for entry in people
        ],
    }


def signature(message: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    """What people see of a presence message (to tell real changes apart)."""
    return tuple(
        (person["user"]["id"], person["activity"]) for person in message["presence"]
    )


SWEEP_SECONDS = 5.0


class PresenceService:
    """Presence for one API process: announcing, leaving and expiry.

    Changes go out through the relay, so every process tells its own
    connections. Every few seconds each process also looks again at the
    notes where it last showed someone, to notice entries that expired
    without anyone leaving (a closed laptop, a lost network).
    """

    def __init__(
        self,
        store: PresenceStore,
        publish,
        hub,
        ttl_seconds: int,
    ) -> None:
        self.store = store
        self._publish = publish
        self._hub = hub
        self.ttl_ms = ttl_seconds * 1000

    async def announce(self, note_id: str, entry: PresenceEntry) -> dict[str, Any]:
        """Add or refresh an entry; returns the note's presence now."""
        changed = await self.store.set(note_id, entry, self.ttl_ms)
        message = presence_message(note_id, await self.store.entries(note_id))
        if changed:
            await self._broadcast(message)
        return message

    async def leave(self, note_id: str, connection_id: str) -> None:
        if await self.store.remove(note_id, connection_id):
            await self._broadcast(
                presence_message(note_id, await self.store.entries(note_id))
            )

    async def sweep_once(self) -> None:
        for note_id in self._hub.notes_with_presence():
            message = presence_message(note_id, await self.store.entries(note_id))
            if signature(message) != self._hub.presence_signature(note_id):
                self._hub.dispatch(message)

    async def sweep_forever(self) -> None:
        while True:
            await anyio.sleep(SWEEP_SECONDS)
            try:
                await self.sweep_once()
            except Exception:  # noqa: BLE001 - try again next time
                logger.warning("Presence sweep failed; trying again.", exc_info=True)

    async def _broadcast(self, message: dict[str, Any]) -> None:
        # The Redis relay publishes with a blocking client.
        await anyio.to_thread.run_sync(self._publish, message)
