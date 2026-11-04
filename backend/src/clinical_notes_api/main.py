from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_notes_api import auth, health
from clinical_notes_api.config import Settings, get_settings
from clinical_notes_api.db.session import create_db_engine, create_session_factory
from clinical_notes_api.errors import register_error_handlers

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

    return app


app = create_app()
