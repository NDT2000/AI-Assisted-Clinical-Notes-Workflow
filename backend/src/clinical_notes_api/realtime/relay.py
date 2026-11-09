"""How a committed note event reaches every API process's connections.

With REDIS_URL set, events go through a Redis channel that every process
listens to, so a change made through one process reaches browsers connected
to another. Without it (local runs, tests) they go straight to this
process's own connections.

Publishing is best effort. If Redis is unreachable the change is still
saved, with its event, and clients get it when they next catch up from the
event log; they just do not hear about it live.
"""

import asyncio
import contextlib
import json
import logging
from typing import Any, Protocol

import redis
import redis.asyncio as redis_async

from clinical_notes_api.realtime.hub import ConnectionHub

logger = logging.getLogger(__name__)

CHANNEL = "clinical-notes:note-events"
RECONNECT_DELAY_SECONDS = 1.0


class Relay(Protocol):
    def publish(self, message: dict[str, Any]) -> None:
        """Called after commit, from any thread."""

    async def start(self) -> None: ...

    async def stop(self) -> None: ...


class LocalRelay:
    """Only this process's connections: enough for one process."""

    def __init__(self, hub: ConnectionHub) -> None:
        self._hub = hub

    def publish(self, message: dict[str, Any]) -> None:
        self._hub.dispatch_threadsafe(message)

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass


class RedisRelay:
    """Every process's connections, through one Redis channel.

    This process hears its own events back from Redis too, so it does not
    also hand them to its connections directly.
    """

    def __init__(self, url: str, hub: ConnectionHub) -> None:
        self._url = url
        self._hub = hub
        self._publisher = redis.Redis.from_url(
            url,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        self._listener: asyncio.Task[None] | None = None
        self.subscribed = asyncio.Event()

    def publish(self, message: dict[str, Any]) -> None:
        try:
            self._publisher.publish(CHANNEL, json.dumps(message))
        except redis.RedisError as error:
            logger.warning(
                "Note event %s was not relayed (%s); clients catch up later.",
                message.get("eventId"),
                error,
            )

    async def start(self) -> None:
        self._listener = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._listener is not None:
            self._listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener
        self._publisher.close()

    async def _listen(self) -> None:
        client = redis_async.Redis.from_url(self._url)
        try:
            while True:
                try:
                    async with client.pubsub() as pubsub:
                        await pubsub.subscribe(CHANNEL)
                        self.subscribed.set()
                        async for item in pubsub.listen():
                            if item.get("type") == "message":
                                self._hub.dispatch(json.loads(item["data"]))
                except redis.RedisError as error:
                    self.subscribed.clear()
                    logger.warning("Redis relay interrupted (%s); retrying.", error)
                    await asyncio.sleep(RECONNECT_DELAY_SECONDS)
        finally:
            await client.aclose()


def create_relay(redis_url: str | None, hub: ConnectionHub) -> Relay:
    return RedisRelay(redis_url, hub) if redis_url else LocalRelay(hub)
