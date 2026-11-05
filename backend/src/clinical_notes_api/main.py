from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_notes_api import auth, health, telemetry
from clinical_notes_api.config import Settings, get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory
from clinical_notes_api.errors import register_error_handlers
from clinical_notes_api.notes.router import router as notes_router

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="Clinical Notes Workflow API",
        version="0.1.0",
    )
    app.state.settings = settings
    # Connects lazily, on the first request that needs the database.
    app.state.session_factory = create_session_factory(
        create_db_engine(settings.database_url),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_error_handlers(app)

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(notes_router, prefix=API_PREFIX)
    app.include_router(telemetry.router, prefix=API_PREFIX)

    _document_validation_errors(app)

    return app


def _document_validation_errors(app: FastAPI) -> None:
    """Describe invalid requests as they are answered: 400 invalid_request.

    FastAPI documents them as 422 with its own body, which would give the
    frontend's generated types the wrong error shape.
    """
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is not None:
            return app.openapi_schema

        document = generate()
        invalid_request = {
            "description": "invalid_request: the request is malformed.",
            "content": {
                "application/json": {
                    "schema": {"$ref": "#/components/schemas/ErrorResponse"},
                },
            },
        }
        for operation in (
            operation
            for path in document["paths"].values()
            for operation in path.values()
        ):
            responses = operation.get("responses", {})
            fastapi_422 = responses.get("422", {})
            if "HTTPValidationError" in str(fastapi_422):
                del responses["422"]
                responses["400"] = invalid_request

        schemas = document.get("components", {}).get("schemas", {})
        for name in ("HTTPValidationError", "ValidationError"):
            schemas.pop(name, None)
        return document

    app.openapi = openapi  # type: ignore[method-assign]


app = create_app()
