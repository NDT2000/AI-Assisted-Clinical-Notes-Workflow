"""The live connection: GET /api/realtime (WebSocket).

The protocol, in JSON text messages:

  browser -> server
    {"type": "auth", "token": "<access token>"}
        First, within 5 seconds; again whenever the token is renewed.
    {"type": "subscribe", "noteIds": [...], "afterCursor": N}
        Follow these notes (replacing the previous set), having seen every
        event up to N. Missed events are sent first, then live ones.

  server -> browser
    {"type": "ready", "userId": ...}          signed in
    {"type": "event", "event": {...}}         a note change (NoteRealtimeEvent)
    {"type": "caughtUp", "cursor": N}         missed events sent; live from here
    {"type": "resetRequired", "noteIds": [...]}  reload these notes instead
    {"type": "error", "code": ..., "message": ...}
    {"type": "ping"}                          every 25 seconds, to keep it open

The token never goes in the URL. The connection closes with 4401 when the
token expires without being renewed (renew and reconnect), 4403 for a
deactivated account, and 4400 for a broken protocol.
"""

import asyncio
import contextlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import anyio
from anyio.abc import TaskGroup
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from clinical_notes_api.config import Settings
from clinical_notes_api.db import User
from clinical_notes_api.db.models import ID_LENGTH
from clinical_notes_api.notes.events import EventsPage, events_after, latest_cursor
from clinical_notes_api.realtime.hub import ConnectionHub
from clinical_notes_api.security import InvalidTokenError, decode_access_token

router = APIRouter()

AUTH_TIMEOUT_SECONDS = 5.0
KEEPALIVE_SECONDS = 25.0
MAX_NOTES = 200
MAX_MESSAGE_LENGTH = 64_000
MAX_WAITING_MESSAGES = 1_000

CLOSE_BAD_MESSAGE = 4400
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_TOO_SLOW = 4408
# Refused before the connection opens (the browser sees a failed handshake).
CLOSE_POLICY = 1008


class ProtocolError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class SignedInUser:
    user_id: str
    expires_at: datetime


def origin_allowed(websocket: WebSocket, settings: Settings) -> bool:
    """Browsers send cookies and connect from any page: check where from.

    Unlike ordinary requests, WebSockets are not limited to the page's own
    site by the browser, so another site could otherwise connect.
    """
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    scheme = "https" if websocket.url.scheme == "wss" else "http"
    own_origin = f"{scheme}://{websocket.url.netloc}"
    return origin == own_origin or origin in settings.cors_origins


@router.websocket("/realtime")
async def realtime(websocket: WebSocket) -> None:
    app = websocket.app
    if not origin_allowed(websocket, app.state.settings):
        await websocket.close(code=CLOSE_POLICY)
        return

    await websocket.accept()
    hub: ConnectionHub = app.state.hub
    hub.bind_loop(asyncio.get_running_loop())
    await RealtimeConnection(
        websocket,
        hub=hub,
        session_factory=app.state.session_factory,
        settings=app.state.settings,
    ).run()


class RealtimeConnection:
    def __init__(
        self,
        websocket: WebSocket,
        *,
        hub: ConnectionHub,
        session_factory,
        settings: Settings,
    ) -> None:
        self.websocket = websocket
        self.hub = hub
        self.session_factory = session_factory
        self.settings = settings
        self.outbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue(MAX_WAITING_MESSAGES)
        self.group: TaskGroup | None = None
        self.close_code: int | None = None
        self.close_reason = ""
        self.user: SignedInUser | None = None
        self.following: set[str] = set()
        # While catching up, live events wait here so none is missed or
        # sent twice; then those not already sent follow.
        self.catching_up = False
        self.held_back: list[dict[str, Any]] = []
        self.caught_up_through = 0

    # --- Lifecycle ----------------------------------------------------------

    async def run(self) -> None:
        try:
            self.user = await self.first_auth()
        except ProtocolError as error:
            await self.close(error.code, error.message)
            return

        self.send({"type": "ready", "userId": self.user.user_id})
        # The framework runs on anyio: its task group ends every loop
        # cleanly as soon as any of them stops the connection.
        try:
            async with anyio.create_task_group() as group:
                self.group = group
                for loop in (
                    self.receive_loop,
                    self.send_loop,
                    self.keepalive_loop,
                    self.expiry_loop,
                ):
                    group.start_soon(self.stop_when_done, loop)
        finally:
            self.group = None
            self.hub.leave(self.deliver)

        if self.close_code is not None:
            # Whatever was queued before the close still goes out first.
            await self.flush_outbox()
            await self.close(self.close_code, self.close_reason)

    async def stop_when_done(self, loop) -> None:
        """Run one loop; when it ends, so does the connection."""
        # A disconnected browser ends a loop with one of these.
        with contextlib.suppress(WebSocketDisconnect, RuntimeError):
            await loop()
        if self.group is not None:
            self.group.cancel_scope.cancel()

    def finish(self, code: int, reason: str) -> None:
        if self.close_code is None:
            self.close_code = code
            self.close_reason = reason
        if self.group is not None:
            self.group.cancel_scope.cancel()

    async def close(self, code: int, reason: str) -> None:
        if self.websocket.client_state == WebSocketState.CONNECTED:
            with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                await self.websocket.close(code=code, reason=reason)

    # --- Sending --------------------------------------------------------------

    def send(self, message: dict[str, Any]) -> None:
        try:
            self.outbox.put_nowait(message)
        except asyncio.QueueFull:
            self.finish(
                CLOSE_TOO_SLOW,
                "Too many updates are waiting; reconnect to catch up.",
            )

    async def send_loop(self) -> None:
        while True:
            message = await self.outbox.get()
            await self.websocket.send_text(json.dumps(message))

    async def flush_outbox(self) -> None:
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            while not self.outbox.empty():
                await self.websocket.send_text(json.dumps(self.outbox.get_nowait()))

    async def keepalive_loop(self) -> None:
        while True:
            await anyio.sleep(KEEPALIVE_SECONDS)
            self.send({"type": "ping"})

    def deliver(self, message: dict[str, Any]) -> None:
        """A live event for a followed note (called by the hub)."""
        if message.get("noteId") not in self.following:
            return
        if self.catching_up:
            self.held_back.append(message)
            return
        if message.get("cursor", 0) <= self.caught_up_through:
            return  # already sent while catching up
        self.send({"type": "event", "event": message})

    # --- Receiving ------------------------------------------------------------

    async def receive_loop(self) -> None:
        try:
            while True:
                raw = await self.websocket.receive_text()
                try:
                    await self.handle(self.parse(raw))
                except ProtocolError as error:
                    if error.code in (CLOSE_UNAUTHENTICATED, CLOSE_FORBIDDEN):
                        self.finish(error.code, error.message)
                        return
                    self.send(
                        {
                            "type": "error",
                            "code": "invalid_message",
                            "message": error.message,
                        }
                    )
        except WebSocketDisconnect:
            return

    def parse(self, raw: str) -> dict[str, Any]:
        if len(raw) > MAX_MESSAGE_LENGTH:
            raise ProtocolError(CLOSE_BAD_MESSAGE, "The message is too long.")
        try:
            message = json.loads(raw)
        except json.JSONDecodeError as error:
            raise ProtocolError(CLOSE_BAD_MESSAGE, "Send JSON messages.") from error
        if not isinstance(message, dict) or not isinstance(message.get("type"), str):
            raise ProtocolError(CLOSE_BAD_MESSAGE, "Every message needs a type.")
        return message

    async def handle(self, message: dict[str, Any]) -> None:
        if message["type"] == "auth":
            renewed = await self.authenticate(message)
            if self.user is not None and renewed.user_id != self.user.user_id:
                raise ProtocolError(
                    CLOSE_UNAUTHENTICATED,
                    "The new token belongs to another user.",
                )
            self.user = renewed
        elif message["type"] == "subscribe":
            await self.subscribe(message)
        else:
            raise ProtocolError(
                CLOSE_BAD_MESSAGE,
                f"Unknown message type {message['type']!r}.",
            )

    # --- Signing in -----------------------------------------------------------

    async def first_auth(self) -> SignedInUser:
        try:
            with anyio.fail_after(AUTH_TIMEOUT_SECONDS):
                raw = await self.websocket.receive_text()
        except TimeoutError as error:
            raise ProtocolError(
                CLOSE_UNAUTHENTICATED, "Send your access token first."
            ) from error
        except WebSocketDisconnect as error:
            raise ProtocolError(CLOSE_UNAUTHENTICATED, "Disconnected.") from error

        message = self.parse(raw)
        if message["type"] != "auth":
            raise ProtocolError(CLOSE_UNAUTHENTICATED, "Send your access token first.")
        return await self.authenticate(message)

    async def authenticate(self, message: dict[str, Any]) -> SignedInUser:
        token = message.get("token")
        if not isinstance(token, str) or not token:
            raise ProtocolError(CLOSE_UNAUTHENTICATED, "The token is missing.")
        try:
            claims = decode_access_token(token, self.settings)
        except InvalidTokenError as error:
            raise ProtocolError(
                CLOSE_UNAUTHENTICATED,
                "Your session is invalid or has expired.",
            ) from error

        user = await run_in_threadpool(self.load_user, claims.user_id)
        if user is None or user.password_hash is None:
            raise ProtocolError(
                CLOSE_UNAUTHENTICATED,
                "Your session is invalid or has expired.",
            )
        if not user.is_active:
            raise ProtocolError(CLOSE_FORBIDDEN, "This account is deactivated.")
        return SignedInUser(user_id=user.id, expires_at=claims.expires_at)

    def load_user(self, user_id: str) -> User | None:
        with self.session_factory() as session:
            return session.get(User, user_id)

    async def expiry_loop(self) -> None:
        while self.user is not None:
            remaining = (self.user.expires_at - datetime.now(UTC)).total_seconds()
            if remaining <= 0:
                self.finish(
                    CLOSE_UNAUTHENTICATED,
                    "Your session has expired. Renew your token and reconnect.",
                )
                return
            # A renewal moves expires_at; look again when this one would end.
            await anyio.sleep(remaining)

    # --- Following notes ------------------------------------------------------

    async def subscribe(self, message: dict[str, Any]) -> None:
        note_ids = message.get("noteIds")
        after = message.get("afterCursor", 0)
        if not isinstance(note_ids, list) or not all(
            isinstance(note_id, str) and 0 < len(note_id) <= ID_LENGTH
            for note_id in note_ids
        ):
            raise ProtocolError(CLOSE_BAD_MESSAGE, "noteIds must be a list of ids.")
        if len(set(note_ids)) > MAX_NOTES:
            raise ProtocolError(
                CLOSE_BAD_MESSAGE,
                f"Follow at most {MAX_NOTES} notes at a time.",
            )
        if isinstance(after, bool) or not isinstance(after, int) or after < 0:
            raise ProtocolError(
                CLOSE_BAD_MESSAGE,
                "afterCursor must be a whole number of at least 0.",
            )

        self.following = set(note_ids)
        self.catching_up = True
        self.held_back = []
        self.hub.follow(self.deliver, self.following)

        sent_through = after
        while True:
            page = await run_in_threadpool(self.read_events, note_ids, sent_through)
            if page.reset_required:
                sent_through = await run_in_threadpool(self.read_latest_cursor)
                self.send({"type": "resetRequired", "noteIds": sorted(self.following)})
                break
            for event in page.events:
                self.send({"type": "event", "event": event})
                sent_through = event["cursor"]
            if not page.has_more:
                break

        held_back, self.held_back = self.held_back, []
        self.catching_up = False
        self.caught_up_through = sent_through
        for event in sorted(held_back, key=lambda item: item.get("cursor", 0)):
            self.deliver(event)
        self.send({"type": "caughtUp", "cursor": sent_through})

    def read_events(self, note_ids: list[str], after: int) -> EventsPage:
        with self.session_factory() as session:
            return events_after(session, note_ids, after)

    def read_latest_cursor(self) -> int:
        with self.session_factory() as session:
            return latest_cursor(session)
