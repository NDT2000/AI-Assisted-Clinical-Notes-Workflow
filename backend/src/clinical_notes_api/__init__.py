"""Backend API for the Clinical Notes Workflow."""


def main() -> None:
    """Run the development server (`uv run clinical-notes-api`)."""
    import uvicorn

    uvicorn.run(
        "clinical_notes_api.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        # Live-connection messages are small; refuse anything large.
        ws_max_size=65_536,
    )
