from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import status


@dataclass(slots=True)
class AppError(Exception):
    message: str
    status_code: int
    error_code: str
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message


class ToolNotFoundError(AppError):
    def __init__(self, slug_or_id: str) -> None:
        super().__init__(
            message=f"No tool found with identifier '{slug_or_id}'.",
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="tool_not_found",
        )


class ToolNotLiveError(AppError):
    def __init__(self, slug: str) -> None:
        super().__init__(
            message=f"Tool '{slug}' is not live right now.",
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="tool_not_live",
        )


class InvalidAPIKeyError(AppError):
    def __init__(self, message: str = "API key is invalid or inactive.") -> None:
        super().__init__(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="invalid_api_key",
        )


class RateLimitExceededError(AppError):
    def __init__(self, limit: int, remaining: int = 0) -> None:
        super().__init__(
            message="Rate limit exceeded.",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            error_code="rate_limit_exceeded",
            details={
                "limit": limit,
                "remaining": remaining,
            },
        )


class InsufficientFundsError(AppError):
    def __init__(self) -> None:
        super().__init__(
            message="Insufficient funds for this action.",
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            error_code="insufficient_funds",
        )


class UploadFailedError(AppError):
    def __init__(self, message: str = "Source upload failed.", *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message=message,
            status_code=status.HTTP_502_BAD_GATEWAY,
            error_code="upload_failed",
            details=details or {},
        )


class ContainerBuildError(AppError):
    def __init__(self, message: str = "Container build failed.", *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message=message,
            status_code=status.HTTP_502_BAD_GATEWAY,
            error_code="container_build_failed",
            details=details or {},
        )


class Unauthorized(AppError):
    def __init__(self, message: str = "Authentication required.") -> None:
        super().__init__(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="unauthorized",
        )


class Forbidden(AppError):
    def __init__(self, message: str = "You are not allowed to perform this action.") -> None:
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="forbidden",
        )
