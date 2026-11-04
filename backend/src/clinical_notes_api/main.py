from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from clinical_notes_api import health
from clinical_notes_api.config import Settings, get_settings

API_PREFIX = "/api"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(
        title="Clinical Notes Workflow API",
        version="0.1.0",
    )
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=API_PREFIX)

    return app


app = create_app()
