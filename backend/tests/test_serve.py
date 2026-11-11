"""Starting the API for production: `clinical-notes-serve`."""

from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

import clinical_notes_api
from clinical_notes_api.config import Settings, get_settings

PROXY_ADDRESS = "172.18.0.5"
VISITOR_ADDRESS = "203.0.113.7"


@pytest.fixture
def uvicorn_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Record uvicorn.run calls instead of starting a server."""
    import uvicorn

    calls: list[dict[str, Any]] = []

    def fake_run(app: str, **options: Any) -> None:
        calls.append({"app": app, **options})

    monkeypatch.setattr(uvicorn, "run", fake_run)
    return calls


@pytest.fixture
def fresh_settings(monkeypatch: pytest.MonkeyPatch):
    """Settings read anew from the environment, ignoring the local .env."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.usefixtures("fresh_settings")
def test_production_server_uses_settings_and_trusts_only_the_proxy(
    monkeypatch: pytest.MonkeyPatch,
    uvicorn_calls: list[dict[str, Any]],
) -> None:
    monkeypatch.setenv("API_HOST", "0.0.0.0")  # noqa: S104 - inside a container
    monkeypatch.setenv("API_PORT", "8080")
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "172.16.0.0/12, 10.0.0.1")

    clinical_notes_api.serve()

    [call] = uvicorn_calls
    assert call["app"] == "clinical_notes_api.main:app"
    assert call["host"] == "0.0.0.0"  # noqa: S104
    assert call["port"] == 8080
    assert "reload" not in call
    assert call["proxy_headers"] is True
    assert call["forwarded_allow_ips"] == "172.16.0.0/12,10.0.0.1"
    assert call["ws_max_size"] == clinical_notes_api.WEBSOCKET_MAX_MESSAGE_BYTES
    assert call["server_header"] is False


def test_production_server_defaults_to_local_only() -> None:
    settings = Settings(_env_file=None)

    assert settings.api_host == "127.0.0.1"
    assert settings.api_port == 8000
    assert settings.forwarded_allow_ips == "127.0.0.1"


@pytest.mark.parametrize(
    "value",
    [
        "*",
        "127.0.0.1,*",
        "",
        " , ",
        "nginx",
        "172.18.0.5/12",  # host bits set: uvicorn would silently ignore it
        "300.1.1.1",
    ],
)
def test_untrustworthy_proxy_lists_are_refused(value: str) -> None:
    with pytest.raises(ValueError, match="FORWARDED_ALLOW_IPS"):
        Settings(_env_file=None, forwarded_allow_ips=value)


def _address_probe(forwarded_allow_ips: str) -> TestClient:
    """An app that reports the visitor address the API would see."""
    settings = Settings(_env_file=None, forwarded_allow_ips=forwarded_allow_ips)
    app = FastAPI()

    @app.get("/address")
    def address(request: Request) -> str:
        assert request.client is not None
        return request.client.host

    wrapped = ProxyHeadersMiddleware(app, trusted_hosts=settings.forwarded_allow_ips)
    return TestClient(wrapped, client=(PROXY_ADDRESS, 50000))


def test_requests_from_a_trusted_proxy_count_against_the_visitor() -> None:
    client = _address_probe("172.16.0.0/12")

    response = client.get("/address", headers={"X-Forwarded-For": VISITOR_ADDRESS})

    assert response.json() == VISITOR_ADDRESS


def test_forwarded_addresses_from_anyone_else_are_ignored() -> None:
    client = _address_probe("127.0.0.1")

    response = client.get("/address", headers={"X-Forwarded-For": VISITOR_ADDRESS})

    assert response.json() == PROXY_ADDRESS
