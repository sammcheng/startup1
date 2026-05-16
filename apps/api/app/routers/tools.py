import math
import uuid
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Query, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_current_user, get_db, get_redis, require_seller
from app.exceptions import AppError, Forbidden, RateLimitExceededError, ToolNotFoundError, ToolNotLiveError
from app.models.tool import ToolStatus
from app.models.user import User
from app.schemas.docs import ToolDocumentation
from app.schemas.tool import ToolCreate, ToolFilters, ToolListResponse, ToolResponse, ToolUpdate
from app.services import docs_service, proxy_service, tool_service

router = APIRouter(prefix="/tools", tags=["tools"])

DEMO_RATE_LIMIT_WINDOW_SECONDS = 60 * 60


# ---------------------------------------------------------------------------
# Dependency: parse ToolFilters from query params
# ---------------------------------------------------------------------------


def _parse_filters(
    category: str | None = Query(None),
    min_price: float | None = Query(None, ge=0),
    max_price: float | None = Query(None, ge=0),
    search: str | None = Query(None, max_length=100),
    is_featured: bool | None = Query(None),
    sort_by: str = Query("newest", pattern="^(popular|newest|price_low|price_high)$"),
) -> ToolFilters:
    return ToolFilters(
        category=category,  # type: ignore[arg-type]
        min_price=min_price,
        max_price=max_price,
        search=search,
        is_featured=is_featured,
        sort_by=sort_by,  # type: ignore[arg-type]
    )


def _demo_client_identifier(request: Request) -> str:
    forwarded_for = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "anonymous"


async def _check_demo_rate_limit(redis: Redis, request: Request, slug: str) -> tuple[int, int]:
    limit = settings.demo_rate_limit_per_hour
    key = f"demo-ratelimit:{slug}:{_demo_client_identifier(request)}"
    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, DEMO_RATE_LIMIT_WINDOW_SECONDS)
    if current > limit:
        raise RateLimitExceededError(limit, 0)
    return limit, limit - current


# ---------------------------------------------------------------------------
# GET /tools/me  — must be declared BEFORE /{slug} to avoid routing collision
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=list[ToolResponse],
    summary="Get current seller's tools",
)
async def get_my_tools(
    current_user: Annotated[User, Depends(require_seller)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> list[ToolResponse]:
    """Return all tools owned by the authenticated seller (any status)."""
    tools = await tool_service.get_seller_tools(db, current_user.id)
    slugs = [t.slug for t in tools]
    views = await tool_service.get_view_counts(redis, slugs)

    return [
        ToolResponse.model_validate(t).model_copy(update={"view_count": views.get(t.slug, 0)})
        for t in tools
    ]


# ---------------------------------------------------------------------------
# POST /tools
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ToolResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new tool",
)
async def create_tool(
    body: ToolCreate,
    current_user: Annotated[User, Depends(require_seller)],
    db: AsyncSession = Depends(get_db),
) -> ToolResponse:
    """Create a tool in 'draft' status. Requires seller role."""
    tool = await tool_service.create_tool(db, current_user.id, body)
    return ToolResponse.model_validate(tool)


# ---------------------------------------------------------------------------
# GET /tools
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=ToolListResponse,
    summary="List live tools",
)
async def list_tools(
    filters: Annotated[ToolFilters, Depends(_parse_filters)],
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolListResponse:
    """Public endpoint. Returns paginated live tools with optional filters."""
    items, total = await tool_service.list_live_tools(db, filters, page, limit)
    slugs = [t.slug for t in items]
    views = await tool_service.get_view_counts(redis, slugs)

    tool_responses = [
        ToolResponse.model_validate(t).model_copy(update={"view_count": views.get(t.slug, 0)})
        for t in items
    ]

    return ToolListResponse(
        items=tool_responses,
        total=total,
        page=page,
        limit=limit,
        pages=math.ceil(total / limit) if total else 0,
    )


# ---------------------------------------------------------------------------
# POST /tools/{slug}/demo
# ---------------------------------------------------------------------------


@router.post(
    "/{slug}/demo",
    summary="Run a public demo request for a live tool",
)
async def run_tool_demo(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> Response:
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)
    if tool.status != ToolStatus.live or not tool.api_endpoint:
        raise ToolNotLiveError(slug)

    limit, remaining = await _check_demo_rate_limit(redis, request, slug)
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    request_body = await request.body()
    started_at = datetime.now(timezone.utc)

    upstream_status_code = status.HTTP_502_BAD_GATEWAY
    upstream_content = b""
    upstream_headers: dict[str, str] = {}
    upstream_media_type = "application/json"

    try:
        upstream_response = await proxy_service.forward_request(
            api_endpoint=tool.api_endpoint,
            request=request,
            request_body=request_body,
            request_id=request_id,
            tool_slug=tool.slug,
            timeout_seconds=settings.tool_request_timeout_seconds,
        )
        upstream_status_code = upstream_response.status_code
        upstream_content = upstream_response.content
        upstream_headers = proxy_service.filter_response_headers(upstream_response.headers)
        upstream_media_type = upstream_response.headers.get("content-type", "application/json")
        normalized_gateway_error = proxy_service.normalize_platform_gateway_error(upstream_response)
        if normalized_gateway_error:
            upstream_status_code, upstream_content, upstream_headers, upstream_media_type = normalized_gateway_error
    except httpx.TimeoutException:
        upstream_status_code = status.HTTP_504_GATEWAY_TIMEOUT
        upstream_content = b'{"error":{"code":"TOOL_TIMEOUT","message":"The tool demo took too long to respond."}}'
        upstream_headers = {"content-type": "application/json"}
    except httpx.HTTPError:
        upstream_content = b'{"error":{"code":"TOOL_UNAVAILABLE","message":"The tool demo could not be reached right now."}}'
        upstream_headers = {"content-type": "application/json"}
    except Exception:
        upstream_content = b'{"error":{"code":"TOOL_REQUEST_FAILED","message":"The demo request failed before completion."}}'
        upstream_headers = {"content-type": "application/json"}

    response_time_ms = max(int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000), 1)
    await tool_service.increment_total_requests(redis, tool.id)

    upstream_headers.update(
        {
            "X-HackMarket-Request-Id": request_id,
            "X-HackMarket-Response-Time-Ms": str(response_time_ms),
            "X-Demo-RateLimit-Remaining": str(remaining),
            "X-Demo-RateLimit-Limit": str(limit),
        }
    )
    return Response(
        content=upstream_content,
        status_code=upstream_status_code,
        media_type=upstream_media_type,
        headers=upstream_headers,
    )


# ---------------------------------------------------------------------------
# GET /tools/{slug}/docs
# ---------------------------------------------------------------------------


@router.get(
    "/{slug}/docs",
    response_model=ToolDocumentation,
    summary="Get generated API documentation for a tool",
)
async def get_tool_docs(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ToolDocumentation:
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)
    return docs_service.generate_tool_docs(tool, public_api_base_url=str(request.base_url).rstrip("/"))


# ---------------------------------------------------------------------------
# GET /tools/{slug}
# ---------------------------------------------------------------------------


@router.get(
    "/{slug}",
    response_model=ToolResponse,
    summary="Get tool by slug",
)
async def get_tool(
    slug: str,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolResponse:
    """Public endpoint. Returns full tool details and increments the view counter."""
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)

    view_count = await tool_service.increment_view_counter(redis, slug)
    return ToolResponse.model_validate(tool).model_copy(update={"view_count": view_count})


# ---------------------------------------------------------------------------
# PUT /tools/{tool_id}
# ---------------------------------------------------------------------------


@router.put(
    "/{tool_id}",
    response_model=ToolResponse,
    summary="Update a tool",
)
async def update_tool(
    tool_id: uuid.UUID,
    body: ToolUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolResponse:
    """Update allowed fields. Caller must own the tool. Blocked while in 'processing'."""
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.seller_id != current_user.id:
        raise Forbidden("You do not own this tool.")
    if tool.status == ToolStatus.processing:
        raise AppError(
            message="Cannot update a tool while it is being processed.",
            status_code=status.HTTP_409_CONFLICT,
            error_code="tool_processing",
        )

    updated = await tool_service.update_tool(db, tool, body, redis=redis)
    view_count = await tool_service.get_view_count(redis, updated.slug)
    return ToolResponse.model_validate(updated).model_copy(update={"view_count": view_count})


# ---------------------------------------------------------------------------
# DELETE /tools/{tool_id}
# ---------------------------------------------------------------------------


@router.delete(
    "/{tool_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Pause (soft-delete) a tool",
)
async def delete_tool(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> None:
    """
    Sets tool status to 'paused'. Does not delete from the database.
    Logs a warning if the tool has had recent usage activity.
    """
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.seller_id != current_user.id:
        raise Forbidden("You do not own this tool.")

    if await tool_service.has_active_consumers(db, tool_id):
        import logging
        logging.getLogger(__name__).warning(
            "Tool %s (%s) paused by seller %s but has active consumers in last 30 days",
            tool.slug,
            tool_id,
            current_user.id,
        )

    await tool_service.pause_tool(db, tool, redis=redis)
