"""The live connection (/api/realtime), the hub and the relays.

These tests commit for real: events reach live connections only after a
change commits. The module's seeded notes are cleared afterwards.
"""

import asyncio
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import redis
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, update
from starlette.websockets import WebSocketDisconnect

from clinical_notes_api.config import Settings
from clinical_notes_api.db import User
from clinical_notes_api.db.session import create_session_factory
from clinical_notes_api.main import create_app
from clinical_notes_api.notes.events import (
    latest_cursor,
    publish_after_commit,
    record_event,
)
from clinical_notes_api.realtime import router as realtime
from clinical_notes_api.realtime.hub import ConnectionHub
from clinical_notes_api.realtime.relay import LocalRelay, RedisRelay
from clinical_notes_api.security import create_access_token
from tests.note_api import auth, content, current_version_id

IN_REVIEW_NOTE = "note-000003"  # reviewer-1
OTHER_NOTE = "note-000012"


@pytest.fixture(scope="module")
def live_app(settings: Settings, seeded_notes: None) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def live(live_app: FastAPI) -> Iterator[TestClient]:
    # As a context manager, so the app's startup and shutdown run.
    with TestClient(live_app) as client:
        yield client


def token(user_id: str, settings: Settings, now: datetime | None = None) -> str:
    value, _ = create_access_token(
        user_id=user_id,
        role="CLINICIAN",
        mfa_verified=False,
        settings=settings,
        now=now or datetime.now(UTC),
    )
    return value


def connect(client: TestClient, settings: Settings, user_id: str = "reviewer-1"):
    """Open the connection and sign in; returns the connection."""
    websocket = client.websocket_connect("/api/realtime").__enter__()
    websocket.send_json({"type": "auth", "token": token(user_id, settings)})
    assert websocket.receive_json() == {"type": "ready", "userId": user_id}
    return websocket


def receive_until(websocket, message_type: str) -> list[dict[str, Any]]:
    """Messages up to and including the first of this type (pings skipped)."""
    received = []
    while True:
        message = websocket.receive_json()
        if message["type"] == "ping":
            continue
        received.append(message)
        if message["type"] == message_type:
            return received


def save(client: TestClient, settings: Settings, note_id: str, mutation_id: str):
    headers = auth("reviewer-1", settings)
    response = client.post(
        f"/api/notes/{note_id}/versions",
        json={
            "baseVersionId": current_version_id(client, headers, note_id),
            "clientMutationId": mutation_id,
            "content": content(plan=f"Live {mutation_id}."),
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def cursor_now(engine: Engine) -> int:
    with create_session_factory(engine)() as session:
        return latest_cursor(session)


def close_code(websocket) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        while True:
            websocket.receive_json()
    return closed.value.code


# --- Signing in -------------------------------------------------------------


def test_the_token_must_come_first(
    live: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "AUTH_TIMEOUT_SECONDS", 0.2)

    with live.websocket_connect("/api/realtime") as websocket:
        assert close_code(websocket) == realtime.CLOSE_UNAUTHENTICATED

    with live.websocket_connect("/api/realtime") as websocket:
        websocket.send_json({"type": "subscribe", "noteIds": [], "afterCursor": 0})
        assert close_code(websocket) == realtime.CLOSE_UNAUTHENTICATED


@pytest.mark.parametrize(
    "message",
    [
        {"type": "auth"},
        {"type": "auth", "token": "not-a-token"},
        "not json",
    ],
)
def test_a_bad_token_is_refused(live: TestClient, message) -> None:
    with live.websocket_connect("/api/realtime") as websocket:
        if isinstance(message, str):
            websocket.send_text(message)
        else:
            websocket.send_json(message)
        assert close_code(websocket) in (
            realtime.CLOSE_UNAUTHENTICATED,
            realtime.CLOSE_BAD_MESSAGE,
        )


def test_an_expired_token_is_refused(live: TestClient, settings: Settings) -> None:
    old = token("reviewer-1", settings, datetime.now(UTC) - timedelta(hours=2))

    with live.websocket_connect("/api/realtime") as websocket:
        websocket.send_json({"type": "auth", "token": old})
        assert close_code(websocket) == realtime.CLOSE_UNAUTHENTICATED


def test_a_deactivated_user_is_refused(
    live: TestClient,
    settings: Settings,
    engine: Engine,
) -> None:
    def set_active(active: bool) -> None:
        with create_session_factory(engine).begin() as session:
            session.execute(
                update(User).where(User.id == "auditor-1").values(is_active=active)
            )

    set_active(False)
    try:
        with live.websocket_connect("/api/realtime") as websocket:
            websocket.send_json({"type": "auth", "token": token("auditor-1", settings)})
            assert close_code(websocket) == realtime.CLOSE_FORBIDDEN
    finally:
        set_active(True)


def test_other_sites_cannot_connect(live: TestClient) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as refused,
        live.websocket_connect(
            "/api/realtime",
            headers={"origin": "https://attacker.example"},
        ),
    ):
        pass

    assert refused.value.code == realtime.CLOSE_POLICY


def test_the_application_can_connect(live: TestClient, settings: Settings) -> None:
    with live.websocket_connect(
        "/api/realtime",
        headers={"origin": "http://localhost:5173"},
    ) as websocket:
        websocket.send_json({"type": "auth", "token": token("reviewer-1", settings)})
        assert websocket.receive_json()["type"] == "ready"


def test_renewing_the_token_keeps_the_connection(
    live: TestClient,
    settings: Settings,
) -> None:
    websocket = connect(live, settings)
    try:
        websocket.send_json({"type": "auth", "token": token("reviewer-1", settings)})
        websocket.send_json({"type": "subscribe", "noteIds": [], "afterCursor": 0})
        assert receive_until(websocket, "caughtUp")[-1]["type"] == "caughtUp"

        websocket.send_json({"type": "auth", "token": token("reviewer-2", settings)})
        assert close_code(websocket) == realtime.CLOSE_UNAUTHENTICATED
    finally:
        websocket.__exit__(None, None, None)


def test_the_connection_closes_when_the_token_runs_out(
    live: TestClient,
    settings: Settings,
) -> None:
    # Issued so that it expires a moment from now.
    almost = datetime.now(UTC) - timedelta(minutes=settings.access_token_minutes)
    almost += timedelta(seconds=1)

    with live.websocket_connect("/api/realtime") as websocket:
        websocket.send_json(
            {"type": "auth", "token": token("reviewer-1", settings, almost)}
        )
        assert websocket.receive_json()["type"] == "ready"
        assert close_code(websocket) == realtime.CLOSE_UNAUTHENTICATED


# --- Catching up and live events --------------------------------------------


def test_missed_events_come_first_then_caught_up(
    live: TestClient,
    settings: Settings,
    engine: Engine,
) -> None:
    before = cursor_now(engine)
    save(live, settings, IN_REVIEW_NOTE, "missed-1")
    save(live, settings, IN_REVIEW_NOTE, "missed-2")

    websocket = connect(live, settings)
    try:
        websocket.send_json(
            {"type": "subscribe", "noteIds": [IN_REVIEW_NOTE], "afterCursor": before}
        )
        messages = receive_until(websocket, "caughtUp")
    finally:
        websocket.__exit__(None, None, None)

    events = [message["event"] for message in messages if message["type"] == "event"]
    assert [event["type"] for event in events] == [
        "note.version_added",
        "note.version_added",
    ]
    assert events[0]["cursor"] < events[1]["cursor"]
    assert events[1]["response"]["savedVersion"]["content"]["plan"] == "Live missed-2."
    assert messages[-1] == {"type": "caughtUp", "cursor": events[1]["cursor"]}


def test_changes_arrive_live_for_followed_notes_only(
    live: TestClient,
    settings: Settings,
    engine: Engine,
) -> None:
    websocket = connect(live, settings)
    try:
        websocket.send_json(
            {
                "type": "subscribe",
                "noteIds": [IN_REVIEW_NOTE],
                "afterCursor": cursor_now(engine),
            }
        )
        assert receive_until(websocket, "caughtUp")[-1]["type"] == "caughtUp"

        # Another note first: it must not arrive.
        record_other_note_event(engine)
        saved = save(live, settings, IN_REVIEW_NOTE, "live-1")

        [message] = receive_until(websocket, "event")
    finally:
        websocket.__exit__(None, None, None)

    event = message["event"]
    assert event["noteId"] == IN_REVIEW_NOTE
    assert event["response"] == saved


def record_other_note_event(engine: Engine) -> None:
    with create_session_factory(engine).begin() as session:
        record_event(
            session,
            note_id=OTHER_NOTE,
            event_type="note.version_added",
            payload={},
            occurred_at=datetime.now(UTC),
        )


def test_a_client_too_far_behind_is_told_to_reload(
    live: TestClient,
    settings: Settings,
    engine: Engine,
) -> None:
    websocket = connect(live, settings)
    try:
        websocket.send_json(
            {
                "type": "subscribe",
                "noteIds": [IN_REVIEW_NOTE],
                "afterCursor": cursor_now(engine) + 1000,
            }
        )
        messages = receive_until(websocket, "caughtUp")
    finally:
        websocket.__exit__(None, None, None)

    assert messages[0] == {"type": "resetRequired", "noteIds": [IN_REVIEW_NOTE]}
    assert messages[-1] == {"type": "caughtUp", "cursor": cursor_now(engine)}


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ({"type": "subscribe", "noteIds": "note-1", "afterCursor": 0}, "list of ids"),
        ({"type": "subscribe", "noteIds": [""], "afterCursor": 0}, "list of ids"),
        ({"type": "subscribe", "noteIds": [], "afterCursor": -1}, "whole number"),
        ({"type": "subscribe", "noteIds": [], "afterCursor": True}, "whole number"),
        (
            {
                "type": "subscribe",
                "noteIds": [f"note-{n}" for n in range(201)],
                "afterCursor": 0,
            },
            "at most 200",
        ),
        ({"type": "dance"}, "Unknown message type"),
        ({"noType": True}, "needs a type"),
    ],
)
def test_broken_messages_get_an_error_and_keep_the_connection(
    live: TestClient,
    settings: Settings,
    message: dict,
    expected: str,
) -> None:
    websocket = connect(live, settings)
    try:
        websocket.send_json(message)
        error = websocket.receive_json()
        websocket.send_json({"type": "subscribe", "noteIds": [], "afterCursor": 0})
        still_open = receive_until(websocket, "caughtUp")
    finally:
        websocket.__exit__(None, None, None)

    assert error["type"] == "error"
    assert expected in error["message"]
    assert still_open[-1]["type"] == "caughtUp"


def test_a_too_long_message_is_refused(live: TestClient, settings: Settings) -> None:
    websocket = connect(live, settings)
    try:
        websocket.send_text("x" * (realtime.MAX_MESSAGE_LENGTH + 1))
        error = websocket.receive_json()
    finally:
        websocket.__exit__(None, None, None)

    assert "too long" in error["message"]


def test_idle_connections_get_a_ping(
    live: TestClient,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(realtime, "KEEPALIVE_SECONDS", 0.05)
    websocket = connect(live, settings)
    try:
        assert websocket.receive_json() == {"type": "ping"}
    finally:
        websocket.__exit__(None, None, None)


# --- Hand-over from catching up to live (unit) ------------------------------


def connection() -> realtime.RealtimeConnection:
    conn = realtime.RealtimeConnection(
        None,  # type: ignore[arg-type] - not used by deliver()
        hub=ConnectionHub(),
        session_factory=None,
        settings=None,  # type: ignore[arg-type]
    )
    conn.following = {"note-1"}
    return conn


def queued(conn: realtime.RealtimeConnection) -> list[int]:
    cursors = []
    while not conn.outbox.empty():
        cursors.append(conn.outbox.get_nowait()["event"]["cursor"])
    return cursors


def test_live_events_wait_while_catching_up_and_are_not_repeated() -> None:
    conn = connection()
    conn.catching_up = True

    conn.deliver({"noteId": "note-1", "cursor": 5})
    conn.deliver({"noteId": "note-2", "cursor": 6})  # not followed
    conn.deliver({"noteId": "note-1", "cursor": 7})

    assert queued(conn) == []
    assert [event["cursor"] for event in conn.held_back] == [5, 7]

    # Catching up sent everything through 5; only 7 is new.
    conn.catching_up = False
    conn.caught_up_through = 5
    for event in conn.held_back:
        conn.deliver(event)
    conn.deliver({"noteId": "note-1", "cursor": 8})

    assert queued(conn) == [7, 8]


def test_a_client_that_cannot_keep_up_is_disconnected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def scenario() -> realtime.RealtimeConnection:
        monkeypatch.setattr(realtime, "MAX_WAITING_MESSAGES", 2)
        conn = connection()
        for cursor in (1, 2, 3):
            conn.deliver({"noteId": "note-1", "cursor": cursor})
        return conn

    conn = asyncio.run(scenario())

    assert conn.close_code == realtime.CLOSE_TOO_SLOW


# --- The hub and the relays -------------------------------------------------


def test_the_hub_follows_and_forgets() -> None:
    hub = ConnectionHub()
    received: list[str] = []

    def deliver(message: dict[str, Any]) -> None:
        received.append(message["noteId"])

    hub.follow(deliver, {"note-1", "note-2"})
    hub.dispatch({"noteId": "note-1"})
    hub.follow(deliver, {"note-2"})
    hub.dispatch({"noteId": "note-1"})
    hub.dispatch({"noteId": "note-2"})
    assert hub.connection_count() == 1
    hub.leave(deliver)
    hub.dispatch({"noteId": "note-2"})

    assert received == ["note-1", "note-2"]
    assert hub.connection_count() == 0


def test_events_are_published_only_after_commit(engine: Engine, seeded_notes) -> None:
    factory = create_session_factory(engine)
    published: list[dict[str, Any]] = []
    publish_after_commit(factory, published.append)

    with factory() as session:
        record_event(
            session,
            note_id=IN_REVIEW_NOTE,
            event_type="note.version_added",
            payload={},
            occurred_at=datetime.now(UTC),
        )
        assert published == []
        session.rollback()
    assert published == []

    with factory.begin() as session:
        event = record_event(
            session,
            note_id=IN_REVIEW_NOTE,
            event_type="note.version_added",
            payload={"saved": True},
            occurred_at=datetime.now(UTC),
        )
        cursor = event.cursor

    assert [message["cursor"] for message in published] == [cursor]
    assert published[0]["response"] == {"saved": True}


def test_the_local_relay_reaches_this_process() -> None:
    async def scenario() -> list[dict[str, Any]]:
        hub = ConnectionHub()
        received: list[dict[str, Any]] = []
        hub.follow(received.append, {"note-1"})
        relay = LocalRelay(hub)

        # Before any connection, there is no loop yet: dropped quietly.
        relay.publish({"noteId": "note-1", "cursor": 0})
        hub.bind_loop(asyncio.get_running_loop())
        await asyncio.to_thread(relay.publish, {"noteId": "note-1", "cursor": 1})
        await asyncio.sleep(0.05)
        return received

    assert asyncio.run(scenario()) == [{"noteId": "note-1", "cursor": 1}]


def redis_url() -> str:
    # Not REDIS_URL: that would switch every test app to the Redis relay.
    url = os.environ.get("TEST_REDIS_URL", "redis://localhost:6380/0")
    try:
        redis.Redis.from_url(url, socket_connect_timeout=1).ping()
    except redis.RedisError as error:
        message = f"Redis is not reachable at {url}: {error}"
        if os.environ.get("REQUIRE_REDIS") == "1":
            pytest.fail(message, pytrace=False)
        pytest.skip(message)
    return url


def test_the_redis_relay_reaches_every_process() -> None:
    url = redis_url()

    async def scenario() -> list[dict[str, Any]]:
        # Two "processes": one publishes, both relays deliver to their hub.
        received: dict[str, list[dict[str, Any]]] = {"a": [], "b": []}
        relays = []
        for name in ("a", "b"):
            hub = ConnectionHub()
            hub.bind_loop(asyncio.get_running_loop())
            hub.follow(received[name].append, {"note-1"})
            relay = RedisRelay(url, hub)
            await relay.start()
            relays.append(relay)
        try:
            for relay in relays:
                await asyncio.wait_for(relay.subscribed.wait(), timeout=5)
            await asyncio.to_thread(
                relays[0].publish, {"noteId": "note-1", "cursor": 42}
            )
            for _ in range(50):
                if received["a"] and received["b"]:
                    break
                await asyncio.sleep(0.05)
        finally:
            for relay in relays:
                await relay.stop()
        return received["a"] + received["b"]

    assert asyncio.run(scenario()) == [
        {"noteId": "note-1", "cursor": 42},
        {"noteId": "note-1", "cursor": 42},
    ]


def test_a_redis_outage_does_not_fail_the_change(
    caplog: pytest.LogCaptureFixture,
) -> None:
    relay = RedisRelay("redis://localhost:1/0", ConnectionHub())

    relay.publish({"eventId": "note-event-1", "noteId": "note-1"})

    assert "was not relayed" in caplog.text
