"""API errors in the same shape as the mock server: {"error", "message"}."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from clinical_notes_api.workflow import Decision


class ErrorResponse(BaseModel):
    error: str
    message: str


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def unauthenticated(message: str = "Sign in to continue.") -> ApiError:
    return ApiError(
        401,
        "unauthenticated",
        message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def forbidden(message: str) -> ApiError:
    return ApiError(403, "forbidden", message)


def ensure_allowed(decision: Decision) -> None:
    """Reject the request with the workflow's own reason when not allowed."""
    if not decision.allowed:
        raise forbidden(decision.reason or "This action is not allowed.")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content=ErrorResponse(error=error.code, message=error.message).model_dump(),
            headers=error.headers,
        )
