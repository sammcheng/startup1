import json
import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db, get_redis, validate_api_key
from app.exceptions import (
    AppError,
    Forbidden,
    RateLimitExceededError,
    ToolNotFoundError,
    ToolNotLiveError,
)
from app.models import APIKey, Tool, ToolPurchase, User
from app.models.tool import OwnershipType, ToolStatus
from app.models.tool_purchase import PurchaseStatus
from app.schemas.usage import UsageLogCreate
from app.services import (
    alert_service,
    proxy_service,
    queue_service,
    tool_service,
    usage_service,
)

RATE_LIMIT_WINDOW_SECONDS = 60
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tools", tags=["gateway"])


@router.api_route(
    "/{tool_slug}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    summary="Proxy buyer requests to seller tools",
)
async def proxy_tool_request_root(
    tool_slug: str,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_context: Annotated[tuple[User, APIKey], Depends(validate_api_key)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    return await _proxy_tool_request_impl(
        tool_slug, "", request, background_tasks, auth_context, db, redis
    )


@router.api_route(
    "/{tool_slug}/{tool_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    summary="Proxy buyer requests to seller tools",
)
async def proxy_tool_request_with_path(
    tool_slug: str,
    tool_path: str,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_context: Annotated[tuple[User, APIKey], Depends(validate_api_key)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    return await _proxy_tool_request_impl(
        tool_slug, tool_path, request, background_tasks, auth_context, db, redis
    )


async def _proxy_tool_request_impl(
    tool_slug: str,
    tool_path: str,
    request: Request,
    background_tasks: BackgroundTasks,
    auth_context: tuple[User, APIKey],
    db: AsyncSession,
    redis: Redis,
) -> Response:
    buyer, api_key = auth_context
    tool = await tool_service.get_tool_by_slug_cached(db, redis, tool_slug)
    if not tool:
        raise ToolNotFoundError(tool_slug)
    if tool.status != ToolStatus.live or not tool.api_endpoint:
        raise ToolNotLiveError(tool_slug)
    await _ensure_gateway_entitlement(db, buyer, tool)

    limit, remaining = await _check_rate_limit(redis, api_key)
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    started_at = datetime.now(UTC)
    request_body = await request.body()

    upstream_status_code = status.HTTP_502_BAD_GATEWAY
    upstream_content = b""
    upstream_headers: dict[str, str] = {}
    upstream_media_type = "application/json"
    error_message: str | None = None

    try:
        upstream_response = await _forward_request(
            tool, request, request_body, request_id, tool_path
        )
        upstream_status_code = upstream_response.status_code
        upstream_content = upstream_response.content
        upstream_headers = proxy_service.filter_response_headers(upstream_response.headers)
        upstream_media_type = upstream_response.headers.get("content-type", "application/json")
        normalized_gateway_error = proxy_service.normalize_platform_gateway_error(upstream_response)
        if normalized_gateway_error:
            upstream_status_code, upstream_content, upstream_headers, upstream_media_type = (
                normalized_gateway_error
            )
            upstream_content = _attach_gateway_error_context(
                upstream_content, request_id, upstream_status_code
            )
            error_message = "The tool service was temporarily unavailable."
    except AppError:
        raise
    except httpx.TimeoutException:
        error_message = "The tool took too long to respond."
        upstream_status_code = status.HTTP_504_GATEWAY_TIMEOUT
        upstream_content = _gateway_error_content(
            "TOOL_TIMEOUT",
            "The tool took too long to respond.",
            upstream_status_code,
            request_id,
            {"timeout_seconds": settings.tool_request_timeout_seconds},
        )
        upstream_headers = {"content-type": "application/json"}
    except httpx.HTTPError:
        error_message = "The tool container could not be reached."
        upstream_status_code = status.HTTP_502_BAD_GATEWAY
        upstream_content = _gateway_error_content(
            "TOOL_UNAVAILABLE",
            "The tool container could not be reached.",
            upstream_status_code,
            request_id,
        )
        upstream_headers = {"content-type": "application/json"}
    except Exception:
        error_message = "The tool request failed before completion."
        upstream_status_code = status.HTTP_502_BAD_GATEWAY
        upstream_content = _gateway_error_content(
            "TOOL_REQUEST_FAILED",
            "The tool request failed before completion.",
            upstream_status_code,
            request_id,
        )
        upstream_headers = {"content-type": "application/json"}

    response_time_ms = max(int((datetime.now(UTC) - started_at).total_seconds() * 1000), 1)

    usage_log_id = uuid.uuid4()
    usage_entry = UsageLogCreate(
        api_key_id=api_key.id,
        tool_id=tool.id,
        user_id=buyer.id,
        request_timestamp=started_at,
        response_time_ms=response_time_ms,
        status_code=upstream_status_code,
        input_size_bytes=len(request_body),
        output_size_bytes=len(upstream_content),
        cost=_calculate_request_cost(tool, upstream_status_code, buyer.id),
        error_message=error_message,
    )
    await _persist_or_queue_usage_log(db, usage_log_id, usage_entry)

    try:
        await tool_service.increment_total_requests(redis, tool.id)
        background_tasks.add_task(tool_service.flush_total_requests_if_needed, redis, tool.id)
    except Exception as exc:
        logger.warning("Failed to update request counter for tool %s", tool.id, exc_info=True)
        await alert_service.send_alert(
            "gateway_request_counter_failed",
            severity="warning",
            summary="A tool request succeeded but its cached request counter was not updated.",
            details={
                "tool_id": str(tool.id),
                "usage_log_id": str(usage_log_id),
                "error_type": type(exc).__name__,
            },
        )

    upstream_headers.update(
        {
            "X-HackMarket-Request-Id": request_id,
            "X-HackMarket-Response-Time-Ms": str(response_time_ms),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Limit": str(limit),
        }
    )
    return Response(
        content=upstream_content,
        status_code=upstream_status_code,
        media_type=upstream_media_type,
        headers=upstream_headers,
    )


async def _check_rate_limit(redis: Redis, api_key: APIKey) -> tuple[int, int]:
    limit = settings.gateway_rate_limit_per_minute
    key = f"ratelimit:{api_key.id}"
    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
    if current > limit:
        await _record_rate_limit_violation(redis, api_key, current)
        raise RateLimitExceededError(limit, 0, RATE_LIMIT_WINDOW_SECONDS)
    return limit, limit - current


async def _ensure_gateway_entitlement(db: AsyncSession, buyer: User, tool: Tool) -> None:
    if tool.ownership_type != OwnershipType.full_sale:
        return
    if tool.seller_id == buyer.id:
        return

    result = await db.execute(
        select(ToolPurchase.id)
        .where(
            ToolPurchase.buyer_id == buyer.id,
            ToolPurchase.tool_id == tool.id,
            ToolPurchase.status == PurchaseStatus.active,
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is None:
        raise Forbidden("Purchase this tool before invoking it with an API key.")


async def _record_rate_limit_violation(
    redis: Redis, api_key: APIKey, current_window_count: int
) -> None:
    violation_key = f"gateway-abuse:{api_key.id}"
    violations = await redis.incr(violation_key)
    if violations == 1:
        await redis.expire(violation_key, settings.gateway_rate_limit_violation_window_seconds)
    if violations == settings.gateway_rate_limit_violation_alert_threshold:
        await alert_service.send_alert(
            "gateway_rate_limit_abuse",
            severity="warning",
            summary="API key repeatedly exceeded gateway rate limits.",
            details={
                "api_key_id": str(api_key.id),
                "api_key_prefix": api_key.key_prefix,
                "current_window_count": current_window_count,
                "limit_per_minute": settings.gateway_rate_limit_per_minute,
                "violation_count": violations,
                "violation_window_seconds": settings.gateway_rate_limit_violation_window_seconds,
            },
        )


async def _forward_request(
    tool: Tool, request: Request, request_body: bytes, request_id: str, tool_path: str = ""
) -> httpx.Response:
    return await proxy_service.forward_request(
        api_endpoint=tool.api_endpoint,
        request=request,
        request_body=request_body,
        request_id=request_id,
        tool_slug=tool.slug,
        tool_path=tool_path,
        timeout_seconds=settings.tool_request_timeout_seconds,
    )


def _gateway_error_content(
    code: str,
    message: str,
    status_code: int,
    request_id: str,
    details: dict | None = None,
) -> bytes:
    return json.dumps(
        {
            "error": {
                "code": code,
                "message": message,
                "status": status_code,
                "request_id": request_id,
                "details": details or {},
            }
        }
    ).encode("utf-8")


def _attach_gateway_error_context(content: bytes, request_id: str, status_code: int) -> bytes:
    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return content
    error = payload.get("error")
    if not isinstance(error, dict):
        return content
    error.setdefault("status", status_code)
    error.setdefault("request_id", request_id)
    error.setdefault("details", {})
    return json.dumps(payload).encode("utf-8")


async def _persist_or_queue_usage_log(
    db: AsyncSession,
    usage_log_id: uuid.UUID,
    entry: UsageLogCreate,
) -> None:
    try:
        await usage_service.persist_usage_log(db, usage_log_id, entry)
        return
    except Exception as exc:
        logger.error("Usage ledger write failed for %s", usage_log_id, exc_info=True)
        persistence_error = type(exc).__name__

    queued = False
    queue_error: str | None = None
    try:
        await queue_service.enqueue_usage_log_job(
            usage_log_id,
            entry.model_dump(mode="json"),
        )
        queued = True
    except Exception as exc:
        queue_error = type(exc).__name__
        logger.error("Usage ledger fallback queue failed for %s", usage_log_id, exc_info=True)

    await alert_service.send_alert(
        "usage_log_persistence_degraded",
        severity="warning" if queued else "critical",
        summary=(
            "A usage record was moved to the retry queue."
            if queued
            else "A usage record could not be persisted or queued."
        ),
        details={
            "usage_log_id": str(usage_log_id),
            "tool_id": str(entry.tool_id),
            "user_id": str(entry.user_id),
            "queued": queued,
            "persistence_error": persistence_error,
            "queue_error": queue_error,
        },
    )


def _calculate_request_cost(
    tool: Tool,
    status_code: int,
    buyer_id: uuid.UUID,
) -> Decimal:
    if status_code >= 500 or tool.ownership_type.value == "full_sale" or tool.seller_id == buyer_id:
        return Decimal("0")
    return tool.price_per_request or Decimal("0")
