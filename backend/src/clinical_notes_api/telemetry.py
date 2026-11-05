"""Usage telemetry from the frontend.

The frontend strips clinical content before sending; the server checks again
and refuses any batch that still carries it. Accepted batches are only
logged for now.
"""

import logging
from typing import Any

from fastapi import APIRouter, status

from clinical_notes_api.dependencies import CurrentUser
from clinical_notes_api.errors import ApiError, ErrorResponse
from clinical_notes_api.notes.schemas import TelemetryAccepted, TelemetryBatch

router = APIRouter(tags=["telemetry"])
logger = logging.getLogger(__name__)

# The same list as the mock server: keys that could carry patient data.
FORBIDDEN_KEYS = frozenset(
    {
        "address",
        "assessment",
        "content",
        "contentPreview",
        "dateOfBirth",
        "displayName",
        "email",
        "medicalRecordNumber",
        "mrn",
        "noteId",
        "objective",
        "patient",
        "patientId",
        "patientName",
        "phone",
        "plan",
        "soap",
        "soapContent",
        "subjective",
    }
)


def has_forbidden_key(value: Any) -> bool:
    """Whether any key, at any depth, is one that could carry patient data."""
    if isinstance(value, list):
        return any(has_forbidden_key(item) for item in value)
    if isinstance(value, dict):
        return any(
            key in FORBIDDEN_KEYS or has_forbidden_key(nested)
            for key, nested in value.items()
        )
    return False


@router.post(
    "/telemetry",
    status_code=status.HTTP_202_ACCEPTED,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
)
def receive_telemetry(batch: TelemetryBatch, user: CurrentUser) -> TelemetryAccepted:
    """Accept a batch of usage events that carries no clinical content."""
    if has_forbidden_key(batch.model_dump(mode="json", by_alias=True)):
        raise ApiError(
            400,
            "clinical_content_rejected",
            "Clinical or patient information is not permitted in telemetry.",
        )

    logger.info(
        "Telemetry: %d events from %s (%s)",
        len(batch.events),
        user.id,
        batch.reason,
    )
    return TelemetryAccepted(accepted=len(batch.events))
