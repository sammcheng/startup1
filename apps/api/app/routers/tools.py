import math
import uuid
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import (
    get_current_user,
    get_db,
    get_optional_current_user,
    get_redis,
    require_seller,
)
from app.exceptions import (
    AppError,
    RateLimitExceededError,
    ToolNotFoundError,
    ToolNotLiveError,
    Unauthorized,
)
from app.middleware.rate_limiter import check_rate_limit
from app.models.tool import OwnershipType, ToolCategory, ToolStatus
from app.models.user import User
from app.schemas.docs import ToolDocumentation
from app.schemas.tool import (
    SellerToolUpdate,
    ToolCreate,
    ToolDiscoverRequest,
    ToolDiscoverResponse,
    ToolFilters,
    ToolListResponse,
    ToolMatch,
    ToolResponse,
    ToolSubmitAnalysis,
    ToolSubmitRequest,
    ToolSubmitResponse,
)
from app.services import discovery_service, docs_service, proxy_service, repo_analyzer, tool_service

router = APIRouter(prefix="/tools", tags=["tools"])

DEMO_RATE_LIMIT_WINDOW_SECONDS = 60 * 60
LIVE_LOCKED_SELLER_FIELDS = frozenset(
    {
        "ownership_type",
        "price_per_request",
        "one_time_price",
        "input_type",
        "output_type",
        "input_schema",
        "output_schema",
    }
)


def _tool_response(tool, *, view_count: int = 0) -> ToolResponse:
    return ToolResponse.model_validate(tool).model_copy(update={"view_count": view_count})


def _public_tool_response(tool, *, view_count: int = 0) -> ToolResponse:
    return _tool_response(tool, view_count=view_count).model_copy(
        update={
            "environment_variables": None,
            "api_endpoint": None,
            "docker_image_uri": None,
            "source_s3_key": None,
            "config_s3_key": None,
        }
    )


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
    forwarded_for = request.headers.get("cf-connecting-ip") or request.headers.get(
        "x-forwarded-for"
    )
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "anonymous"


async def _check_public_rate_limit(redis: Redis, request: Request, action: str) -> None:
    await check_rate_limit(
        redis,
        key=f"public:{action}:{_demo_client_identifier(request)}",
        limit=settings.public_rate_limit_per_minute,
    )


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
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> list[ToolResponse]:
    """Return all tools owned by the authenticated seller (any status)."""
    tools = await tool_service.get_seller_tools(db, current_user.id)
    slugs = [t.slug for t in tools]
    views = await tool_service.get_view_counts(redis, slugs)

    return [_tool_response(t, view_count=views.get(t.slug, 0)) for t in tools]


@router.get(
    "/me/{tool_id}",
    response_model=ToolResponse,
    summary="Get one current seller tool by id",
)
async def get_my_tool(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ToolResponse:
    """Return one authenticated user's owned tool, regardless of status."""
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    view_count = await tool_service.get_view_count(redis, tool.slug)
    return _tool_response(tool, view_count=view_count)


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
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ToolResponse:
    """Create a tool in 'draft' status. Requires seller role."""
    tool = await tool_service.create_tool(db, current_user.id, body)
    return _tool_response(tool)


# ---------------------------------------------------------------------------
# POST /tools/discover — server-side keyword-weighted ranking (ported from kc)
# Declared BEFORE /{slug} routes to avoid routing collision.
# ---------------------------------------------------------------------------


@router.post(
    "/discover",
    response_model=ToolDiscoverResponse,
    summary="Discover live tools via keyword-weighted scoring",
)
async def discover_tools(
    body: ToolDiscoverRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ToolDiscoverResponse:
    """Tokenize the query, score live tools across name/tagline/description/
    category/schema, and return the top *limit* with a per-result fit line.

    Empty query → returns the most-requested live tools as discovery defaults.
    """
    await _check_public_rate_limit(redis, request, "discover")
    ranked = await discovery_service.discover_tools(
        db,
        query=body.query,
        categories=body.categories,
        limit=body.limit,
    )
    matches = [
        ToolMatch(
            tool=_public_tool_response(tool),
            fit_line=fit,
            match_score=score,
            matched_keywords=matched,
            source="verified",
        )
        for tool, score, matched, fit in ranked
    ]
    return ToolDiscoverResponse(matches=matches, query=body.query)


# ---------------------------------------------------------------------------
# POST /tools/submit — single-call submit flow (ported from kc).
# Paste a GitHub URL, get back a fully-analyzed draft listing. Production
# requires auth so every draft belongs to the submitter's account.
# ---------------------------------------------------------------------------


@router.post(
    "/submit",
    response_model=ToolSubmitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a GitHub repo and get back an analyzed draft listing",
)
async def submit_repo(
    body: ToolSubmitRequest,
    request: Request,
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ToolSubmitResponse:
    """Clone the repo (shallow), run repo_analyzer (OpenRouter Claude Sonnet,
    with dev-only heuristic fallback unless explicitly enabled), create a draft
    Tool owned by the submitter, and return the analyzed listing for review/edit
    on the frontend. Anonymous preview drafts are development-only.

    Mirrors kc's POST /api/submit — one call returns a fully-populated draft.
    """
    await _check_public_rate_limit(redis, request, "submit")
    if settings.environment == "production" and current_user is None:
        raise Unauthorized("Sign in before submitting a tool for analysis.")

    # Lazy imports to keep the module load fast.
    import secrets
    import shutil
    from pathlib import Path

    from app.routers.internal import _get_or_create_system_seller

    github_url = str(body.github_url)
    seller = current_user or await _get_or_create_system_seller(db)

    clone_root = Path(settings.submit_repo_clone_dir)
    clone_id = secrets.token_hex(6)
    repo_path = clone_root / clone_id
    try:
        try:
            await repo_analyzer.clone_repo(github_url, repo_path)
        except Exception as exc:  # noqa: BLE001
            raise AppError(
                code="CLONE_FAILED",
                message=f"Could not clone repository: {exc}",
                status_code=status.HTTP_400_BAD_REQUEST,
            ) from exc

        try:
            analysis = await repo_analyzer.analyze_repo(repo_path, github_url)
        except repo_analyzer.RepoAnalysisUnavailable as exc:
            raise AppError(
                message=str(exc),
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                error_code="repo_analysis_unavailable",
            ) from exc
    finally:
        # Best-effort cleanup — keep the temp tree small.
        shutil.rmtree(repo_path, ignore_errors=True)

    # Map kc-shape analysis → main's ToolCreate.
    tool_data = ToolCreate(
        name=analysis.name,
        tagline=(analysis.description or analysis.name)[:200],
        description=analysis.description or f"Imported from {github_url}.",
        category=ToolCategory(analysis.tool_category),
        ownership_type=OwnershipType.royalty
        if analysis.pricing_model == "royalty"
        else OwnershipType.full_sale,
        github_url=github_url,
        input_schema={
            "fields": [
                {
                    "name": "input",
                    "type": "string",
                    "description": analysis.input_contract,
                    "required": False,
                }
            ]
        },
        output_schema={
            "fields": [
                {
                    "name": "result",
                    "type": "object",
                    "description": analysis.output_contract,
                }
            ]
        },
        documentation=(
            f"# {analysis.name}\n\n{analysis.description}\n\n"
            f"**Complexity:** {analysis.complexity}\n\n"
            f"**Tech stack:** {', '.join(analysis.tech_stack) or 'unspecified'}\n\n"
            f"## Input\n{analysis.input_contract}\n\n"
            f"## Output\n{analysis.output_contract}\n"
        ),
    )

    tool = await tool_service.create_tool(db, seller.id, tool_data)
    return ToolSubmitResponse(
        tool=_tool_response(tool),
        analysis=ToolSubmitAnalysis(
            name=analysis.name,
            description=analysis.description,
            category=analysis.category,
            tech_stack=analysis.tech_stack,
            input_contract=analysis.input_contract,
            output_contract=analysis.output_contract,
            complexity=analysis.complexity,
            suggested_price_cents=analysis.suggested_price_cents,
            pricing_model=analysis.pricing_model,
        ),
        message=(
            (
                "Analyzed and saved as draft. Review the details and submit for listing."
                if settings.openrouter_api_key
                else "Saved as draft using heuristic analysis (OPENROUTER_API_KEY unset)."
            )
            if current_user
            else (
                "Analyzed preview draft. Sign in to save this under your account."
                if settings.openrouter_api_key
                else "Built an anonymous preview draft using heuristic analysis. Sign in to save it to your account."
            )
        ),
    )


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
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ToolListResponse:
    """Public endpoint. Returns paginated live tools with optional filters."""
    items, total = await tool_service.list_live_tools(db, filters, page, limit)
    slugs = [t.slug for t in items]
    views = await tool_service.get_view_counts(redis, slugs)

    tool_responses = [_public_tool_response(t, view_count=views.get(t.slug, 0)) for t in items]

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
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)
    if tool.status != ToolStatus.live or not tool.api_endpoint:
        raise ToolNotLiveError(slug)

    limit, remaining = await _check_demo_rate_limit(redis, request, slug)
    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    request_body = await request.body()
    started_at = datetime.now(UTC)

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
            upstream_status_code, upstream_content, upstream_headers, upstream_media_type = (
                normalized_gateway_error
            )
    except AppError:
        raise
    except httpx.TimeoutException:
        upstream_status_code = status.HTTP_504_GATEWAY_TIMEOUT
        upstream_content = (
            b'{"error":{"code":"TOOL_TIMEOUT","message":"The tool demo took too long to respond."}}'
        )
        upstream_headers = {"content-type": "application/json"}
    except httpx.HTTPError:
        upstream_content = b'{"error":{"code":"TOOL_UNAVAILABLE","message":"The tool demo could not be reached right now."}}'
        upstream_headers = {"content-type": "application/json"}
    except Exception:
        upstream_content = b'{"error":{"code":"TOOL_REQUEST_FAILED","message":"The demo request failed before completion."}}'
        upstream_headers = {"content-type": "application/json"}

    response_time_ms = max(int((datetime.now(UTC) - started_at).total_seconds() * 1000), 1)
    await tool_service.increment_total_requests(redis, tool.id)
    background_tasks.add_task(tool_service.flush_total_requests_if_needed, redis, tool.id)

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
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ToolDocumentation:
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)
    if tool.status != ToolStatus.live:
        raise ToolNotLiveError(slug)
    return docs_service.generate_tool_docs(tool)


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
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ToolResponse:
    """Public endpoint. Returns full tool details and increments the view counter."""
    tool = await tool_service.get_tool_by_slug(db, slug)
    if not tool:
        raise ToolNotFoundError(slug)

    view_count = await tool_service.increment_view_counter(redis, slug)
    return _public_tool_response(tool, view_count=view_count)


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
    body: SellerToolUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> ToolResponse:
    """Update allowed fields. Caller must own the tool. Blocked while in 'processing'."""
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.status == ToolStatus.processing:
        raise AppError(
            message="Cannot update a tool while it is being processed.",
            status_code=status.HTTP_409_CONFLICT,
            error_code="tool_processing",
        )
    locked_fields = body.model_fields_set & LIVE_LOCKED_SELLER_FIELDS
    if tool.status == ToolStatus.live and locked_fields:
        raise AppError(
            message="Pricing and API contracts are locked while a tool is live.",
            status_code=status.HTTP_409_CONFLICT,
            error_code="tool_live_fields_locked",
            details={"locked_fields": sorted(locked_fields)},
        )

    updated = await tool_service.update_tool(db, tool, body, redis=redis)
    view_count = await tool_service.get_view_count(redis, updated.slug)
    return _tool_response(updated, view_count=view_count)


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
    db: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> None:
    """
    Sets tool status to 'paused'. Does not delete from the database.
    Logs a warning if the tool has had recent usage activity.
    """
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))

    if await tool_service.has_active_consumers(db, tool_id):
        import logging

        logging.getLogger(__name__).warning(
            "Tool %s (%s) paused by seller %s but has active consumers in last 30 days",
            tool.slug,
            tool_id,
            current_user.id,
        )

    await tool_service.pause_tool(db, tool, redis=redis)
