"""API errors in the same shape as the mock server: {"error", "message"}.

Some errors carry more fields next to those two, such as the current version
in a version conflict.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from clinical_notes_api.workflow import Decision

# Validation problems listed in one invalid_request message, at most.
MAX_LISTED_PROBLEMS = 3


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
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers
        # Extra JSON fields sent alongside "error" and "message".
        self.details = details or {}


def unauthenticated(message: str = "Sign in to continue.") -> ApiError:
    return ApiError(
        401,
        "unauthenticated",
        message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def forbidden(message: str) -> ApiError:
    return ApiError(403, "forbidden", message)


def not_found(message: str) -> ApiError:
    return ApiError(404, "not_found", message)


def invalid_request(message: str) -> ApiError:
    return ApiError(400, "invalid_request", message)


def conflict(code: str, message: str, **details: Any) -> ApiError:
    """The request breaks a rule about the current state (409)."""
    return ApiError(409, code, message, details=details)


def ensure_allowed(decision: Decision) -> None:
    """Reject the request with the workflow's own reason when not allowed."""
    if not decision.allowed:
        raise forbidden(decision.reason or "This action is not allowed.")


def _describe_validation_error(error: RequestValidationError) -> str:
    problems = []
    for problem in error.errors()[:MAX_LISTED_PROBLEMS]:
        # loc is like ("body", "content", "plan"); "body" says nothing useful.
        location = ".".join(str(part) for part in problem["loc"] if part != "body")
        problems.append(f"{location}: {problem['msg']}" if location else problem["msg"])
    return "The request is invalid. " + "; ".join(problems) + "."


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={
                **ErrorResponse(error=error.code, message=error.message).model_dump(),
                **error.details,
            },
            headers=error.headers,
        )

    # The mock server answers malformed requests with 400 invalid_request,
    # not FastAPI's 422 with its own body shape.
    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=ErrorResponse(
                error="invalid_request",
                message=_describe_validation_error(error),
            ).model_dump(),
        )
