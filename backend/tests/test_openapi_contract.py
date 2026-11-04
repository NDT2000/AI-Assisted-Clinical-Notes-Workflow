from clinical_notes_api.openapi import (
    OPENAPI_PATH,
    build_openapi_document,
    render,
)


def test_committed_openapi_document_is_up_to_date() -> None:
    committed = OPENAPI_PATH.read_text(encoding="utf-8")

    assert committed == render(build_openapi_document()), (
        "contract/openapi.json is stale: run `uv run clinical-notes-openapi`, "
        "then `npm run api:types` in frontend/."
    )
