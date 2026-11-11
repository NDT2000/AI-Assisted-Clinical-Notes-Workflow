"""Smoke test of the running Docker Compose stack, through nginx like a browser.

Run against a stack started with `docker compose up --build`:

    uv run --no-project --with websockets python scripts/smoke_test.py

Checks the app page, a deep link, the security headers, the API health,
sign-in with a seeded user, the notes list and the live connection. Prints
one line per check and exits non-zero if any fails. Passwords are read from
credentials.local.md and never printed.
"""

import argparse
import asyncio
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import websockets

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]

failures: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> bool:
    print(f"{'PASS' if passed else 'FAIL'}  {name}{f' ({detail})' if detail else ''}")
    if not passed:
        failures.append(name)
    return passed


def request(
    base_url: str,
    method: str,
    path: str,
    body: object | None = None,
    token: str | None = None,
) -> tuple[int, dict[str, str], bytes]:
    headers = {"Origin": base_url, "Accept": "application/json, text/html"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    call = urllib.request.Request(  # noqa: S310 - the URL is the stack under test
        base_url + path, method=method, headers=headers, data=data
    )
    try:
        with urllib.request.urlopen(call, timeout=15) as response:  # noqa: S310
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()
    except (urllib.error.URLError, OSError) as error:
        # Nothing answering (stack not running, wrong port): status 0.
        print(f"      {method} {path}: {error}")
        return 0, {}, b""


def first_user(credentials_file: Path, role: str) -> tuple[str, str] | None:
    """(username, password) of the first seeded user with this role."""
    rows = re.findall(
        r"^\| `([^`]+)` \|[^|]*\| ([^|]+?) \| `([^`]+)` \|$",
        credentials_file.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    for username, row_role, password in rows:
        if row_role == role:
            return username, password
    return None


async def check_live_connection(base_url: str, token: str) -> None:
    url = base_url.replace("http", "ws", 1) + "/api/realtime"
    async with websockets.connect(url, origin=base_url, open_timeout=15) as ws:
        await ws.send(json.dumps({"type": "auth", "token": token}))
        ready = json.loads(await asyncio.wait_for(ws.recv(), 15))
        if not check("live connection: signed in", ready.get("type") == "ready"):
            return
        await ws.send(
            json.dumps(
                {
                    "type": "subscribe",
                    "noteIds": [],
                    "afterCursor": ready["latestCursor"],
                }
            )
        )
        caught_up = json.loads(await asyncio.wait_for(ws.recv(), 15))
        check("live connection: caught up", caught_up.get("type") == "caughtUp")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument(
        "--credentials-file",
        type=Path,
        default=REPOSITORY_ROOT / "credentials.local.md",
    )
    arguments = parser.parse_args()
    base_url = arguments.base_url.rstrip("/")

    status, headers, body = request(base_url, "GET", "/")
    check("app page", status == 200 and b'id="root"' in body, f"HTTP {status}")

    status, _, body = request(base_url, "GET", "/notes/note-000001")
    check("deep link serves the app", status == 200 and b'id="root"' in body)

    lowered = {name.lower(): value for name, value in headers.items()}
    check(
        "Content-Security-Policy",
        "default-src 'self'" in lowered.get("content-security-policy", ""),
    )
    check("X-Frame-Options", lowered.get("x-frame-options") == "DENY")
    check("X-Content-Type-Options", lowered.get("x-content-type-options") == "nosniff")

    status, _, body = request(base_url, "GET", "/api/health")
    health = json.loads(body) if status == 200 else {}
    check(
        "API health through nginx",
        health.get("status") == "ok",
        f"HTTP {status}, environment {health.get('environment')}",
    )

    if not arguments.credentials_file.is_file():
        check("credentials file", False, f"{arguments.credentials_file} not found")
        return 1
    user = first_user(arguments.credentials_file, "Clinician")
    if not check("a seeded clinician", user is not None):
        return 1
    username, password = user

    status, headers, body = request(
        base_url,
        "POST",
        "/api/auth/login",
        {"username": username, "password": password},
    )
    cookie = {k.lower(): v for k, v in headers.items()}.get("set-cookie", "")
    if not check(f"sign in as {username}", status == 200, f"HTTP {status}"):
        return 1
    cookie_flags = ("httponly", "secure", "samesite=strict")
    check(
        "sign-in cookie is HttpOnly, Secure and SameSite=Strict",
        all(flag in cookie.lower() for flag in cookie_flags),
    )
    token = json.loads(body)["access_token"]

    status, _, body = request(base_url, "GET", "/api/notes", token=token)
    items = json.loads(body).get("items", []) if status == 200 else []
    check("notes list", status == 200 and len(items) > 0, f"{len(items)} on page 1")

    try:
        asyncio.run(check_live_connection(base_url, token))
    except (OSError, TimeoutError, websockets.WebSocketException) as error:
        check("live connection", False, f"{type(error).__name__}: {error}")

    print(f"\n{'All checks passed.' if not failures else f'{len(failures)} failed.'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
