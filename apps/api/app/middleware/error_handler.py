import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.exceptions import AppError
from app.request_context import get_request_id

logger = logging.getLogger(__name__)
SENSITIVE_VALIDATION_ERROR_KEYS = {"input", "ctx", "url"}


def _error_response(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    details: dict | None = None,
    extra_headers: dict[str, str] | None = None,
) -> JSONResponse:
    headers = {"X-HackMarket-Request-Id": request_id}
    if extra_headers:
        headers.update(extra_headers)
    if status_code == status.HTTP_429_TOO_MANY_REQUESTS and details:
        limit = details.get("limit")
        remaining = details.get("remaining")
        retry_after = details.get("retry_after_seconds")
        if limit is not None:
            headers["X-RateLimit-Limit"] = str(limit)
        if remaining is not None:
            headers["X-RateLimit-Remaining"] = str(remaining)
        if retry_after is not None:
            headers["Retry-After"] = str(retry_after)

    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "status": status_code,
                "request_id": request_id,
                "details": details or {},
            }
        },
        headers=headers,
    )


def setup_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(
        request: Request, exc: AppError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        logger.warning(
            "Application error on %s %s: %s",
            request.method,
            request.url.path,
            exc.message,
        )
        return _error_response(
            exc.status_code,
            exc.error_code,
            exc.message,
            request_id,
            exc.details,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        # Pass through the detail from HTTPException as-is when it's a dict
        if isinstance(exc.detail, dict):
            code = exc.detail.get("code", "HTTP_ERROR")
            message = exc.detail.get("message", str(exc.detail))
            details = exc.detail.get("details", {})
        else:
            code = _status_to_code(exc.status_code)
            message = str(exc.detail)
            details = {}

        return _error_response(
            exc.status_code,
            str(code).lower(),
            message,
            request_id,
            details,
            dict(exc.headers or {}),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        details = {"errors": exc.errors() if settings.debug else _safe_validation_errors(exc.errors())}
        return _error_response(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Request validation failed.",
            request_id,
            details,
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(
        request: Request, exc: IntegrityError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        logger.warning("Database integrity error on %s %s", request.method, request.url.path)
        return _error_response(
            status.HTTP_409_CONFLICT,
            "database_conflict",
            "This change conflicts with existing data.",
            request_id,
            {"type": type(exc).__name__} if settings.debug else {},
        )

    @app.exception_handler(OperationalError)
    async def operational_error_handler(
        request: Request, exc: OperationalError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        logger.exception("Database operational error on %s %s", request.method, request.url.path)
        return _error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "database_unavailable",
            "The database is temporarily unavailable.",
            request_id,
            {"type": type(exc).__name__} if settings.debug else {},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", get_request_id())
        logger.exception(
            "Unhandled exception on %s %s", request.method, request.url.path
        )
        # Never leak stack traces in production
        details = {"type": type(exc).__name__} if settings.debug else {}
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "internal_server_error",
            "An unexpected error occurred." if not settings.debug else str(exc),
            request_id,
            details,
        )


def _safe_validation_errors(errors: list[dict]) -> list[dict]:
    return [
        {key: value for key, value in error.items() if key not in SENSITIVE_VALIDATION_ERROR_KEYS}
        for error in errors
        if isinstance(error, dict)
    ]


def _status_to_code(status_code: int) -> str:
    """Map common HTTP status codes to a stable error code string."""
    _map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        410: "GONE",
        422: "UNPROCESSABLE_ENTITY",
        429: "RATE_LIMIT_EXCEEDED",
        500: "INTERNAL_SERVER_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    return _map.get(status_code, f"HTTP_{status_code}")
