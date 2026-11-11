"""Backend API for the Clinical Notes Workflow."""

# Live-connection messages are small; refuse anything large.
WEBSOCKET_MAX_MESSAGE_BYTES = 65_536


def main() -> None:
    """Run the development server (`uv run clinical-notes-api`)."""
    import uvicorn

    uvicorn.run(
        "clinical_notes_api.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        ws_max_size=WEBSOCKET_MAX_MESSAGE_BYTES,
    )


def serve() -> None:
    """Run the API for production (`clinical-notes-serve`), as the image does.

    No auto-reload, the address and port from settings, and the visitor's
    real address taken from X-Forwarded-For, but only when the request comes
    from a trusted proxy (FORWARDED_ALLOW_IPS).
    """
    import uvicorn

    from clinical_notes_api.config import get_settings

    settings = get_settings()
    uvicorn.run(
        "clinical_notes_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        ws_max_size=WEBSOCKET_MAX_MESSAGE_BYTES,
        # Do not advertise the server software in every response.
        server_header=False,
    )
