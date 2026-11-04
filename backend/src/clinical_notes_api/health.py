from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from clinical_notes_api.config import Settings, get_app_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    environment: str


@router.get("/health")
def read_health(
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> HealthResponse:
    """Liveness check: the API process is up and configured."""
    return HealthResponse(status="ok", environment=settings.environment)
