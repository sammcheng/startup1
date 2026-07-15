import json
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import AsyncSessionLocal
from app.models.tool import OwnershipType, Tool, ToolStatus
from app.models.usage_log import UsageLog
from app.models.user import User
from app.schemas.tool import SellerToolUpdate, ToolCreate, ToolFilters, ToolUpdate

logger = logging.getLogger(__name__)

_TOOL_CACHE_PREFIX = "tool:cache:"
_TOOL_CACHE_TTL = 60  # seconds
_MARKETPLACE_STATS_CACHE_KEY = "marketplace:stats"
_MARKETPLACE_STATS_CACHE_TTL = 60

_VIEW_KEY_PREFIX = "tool:views:"
_VIEW_FLUSH_THRESHOLD = 50  # flush to DB every N increments (future background task hook)
_REQUEST_COUNT_KEY_PREFIX = "tool:requests:"
_REQUEST_FLUSH_THRESHOLD = 25
_MAX_SLUG_CREATE_ATTEMPTS = 5


def _normalize_price_fields(
    ownership_type: OwnershipType,
    values: dict[str, object],
) -> dict[str, object]:
    normalized = dict(values)
    if ownership_type == OwnershipType.full_sale:
        normalized["price_per_request"] = None
    else:
        normalized["one_time_price"] = None
    return normalized


def _effective_price_expression():
    return case(
        (
            Tool.ownership_type == OwnershipType.full_sale,
            func.coalesce(Tool.one_time_price, 0),
        ),
        else_=func.coalesce(Tool.price_per_request, 0),
    )


def public_availability_conditions():
    """Return the database filters shared by every public catalog query."""
    return (
        Tool.status == ToolStatus.live,
        Tool.seller.has(User.is_active.is_(True)),
    )


def is_publicly_available(tool: Tool, seller: User | None = None) -> bool:
    """Return whether a loaded tool may be shown, sold, or invoked."""
    resolved_seller = seller if seller is not None else tool.seller
    return tool.status == ToolStatus.live and bool(resolved_seller and resolved_seller.is_active)


# ---------------------------------------------------------------------------
# Slug helpers
# ---------------------------------------------------------------------------


def _slugify(name: str) -> str:
    """Convert a tool name to a URL-safe slug."""
    slug = name.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug.strip("-")
    return slug[:90] or "tool"  # leave room for duplicate suffix


async def _find_unique_slug(db: AsyncSession, base_slug: str) -> str:
    """Return *base_slug* if available, otherwise append -2, -3, … until unique."""
    candidate = base_slug
    n = 2
    while True:
        result = await db.execute(select(Tool.id).where(Tool.slug == candidate))
        if result.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base_slug}-{n}"
        n += 1


async def _slug_exists(db: AsyncSession, slug: str) -> bool:
    result = await db.execute(select(Tool.id).where(Tool.slug == slug))
    return result.scalar_one_or_none() is not None


def _slug_candidate(base_slug: str, attempt: int) -> str:
    if attempt == 0:
        return base_slug
    suffix = f"-{attempt + 1}"
    return f"{base_slug[: 100 - len(suffix)]}{suffix}"


# ---------------------------------------------------------------------------
# Redis view counter
# ---------------------------------------------------------------------------


async def increment_view_counter(redis: Redis, slug: str) -> int:
    """
    Increment the Redis view counter for *slug* and return the new total.
    Actual DB flush is left to a background task (future work).
    """
    key = f"{_VIEW_KEY_PREFIX}{slug}"
    count: int = await redis.incr(key)
    return count


async def get_view_count(redis: Redis, slug: str) -> int:
    key = f"{_VIEW_KEY_PREFIX}{slug}"
    raw = await redis.get(key)
    return int(raw) if raw else 0


async def get_view_counts(redis: Redis, slugs: list[str]) -> dict[str, int]:
    """Batch-fetch view counts for a list of slugs using a pipeline."""
    if not slugs:
        return {}
    async with redis.pipeline() as pipe:
        for slug in slugs:
            await pipe.get(f"{_VIEW_KEY_PREFIX}{slug}")
        results = await pipe.execute()
    return {slug: int(v) if v else 0 for slug, v in zip(slugs, results, strict=False)}


async def increment_total_requests(redis: Redis, tool_id: uuid.UUID) -> int:
    key = f"{_REQUEST_COUNT_KEY_PREFIX}{tool_id}"
    count: int = await redis.incr(key)
    return count


async def flush_total_requests_if_needed(redis: Redis, tool_id: uuid.UUID) -> None:
    key = f"{_REQUEST_COUNT_KEY_PREFIX}{tool_id}"
    raw = await redis.get(key)
    pending = int(raw) if raw else 0
    if pending < _REQUEST_FLUSH_THRESHOLD:
        return

    # Atomically grab and reset the counter to avoid losing increments
    # that arrive between the read and the DB write.
    flushed = await redis.getdel(key)
    if not flushed:
        return
    count = int(flushed)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Tool).where(Tool.id == tool_id))
        tool = result.scalar_one_or_none()
        if tool is None:
            return
        tool.total_requests += count
        await db.commit()


# ---------------------------------------------------------------------------
# Active-consumer check
# ---------------------------------------------------------------------------


async def has_active_consumers(db: AsyncSession, tool_id: uuid.UUID) -> bool:
    """Return True if there is any usage activity in the last 30 days."""
    cutoff = datetime.now(UTC) - timedelta(days=30)
    result = await db.execute(
        select(UsageLog.id)
        .where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= cutoff)
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------


async def create_tool(
    db: AsyncSession,
    seller_id: uuid.UUID,
    data: ToolCreate,
) -> Tool:
    values = _normalize_price_fields(data.ownership_type, data.model_dump())
    base_slug = _slugify(data.name)
    first_available_slug = await _find_unique_slug(db, base_slug)
    first_attempt = max(_slug_suffix_attempt(first_available_slug, base_slug), 0)

    for offset in range(_MAX_SLUG_CREATE_ATTEMPTS):
        attempt = first_attempt + offset
        slug = _slug_candidate(base_slug, attempt)
        if offset > 0 and await _slug_exists(db, slug):
            continue

        tool = Tool(
            seller_id=seller_id,
            slug=slug,
            status=ToolStatus.draft,
            **values,
        )
        db.add(tool)
        try:
            await db.commit()
        except IntegrityError as exc:
            await db.rollback()
            if "slug" not in str(exc).lower() or offset == _MAX_SLUG_CREATE_ATTEMPTS - 1:
                raise
            logger.info("Retrying tool creation after slug conflict for slug=%s", slug)
            continue

        # Re-fetch with seller relationship loaded for response serialisation
        result = await db.execute(
            select(Tool).where(Tool.id == tool.id).options(selectinload(Tool.seller))
        )
        return result.scalar_one()

    raise RuntimeError("Could not allocate a unique tool slug after retries.")


def _slug_suffix_attempt(slug: str, base_slug: str) -> int:
    if slug == base_slug:
        return 0
    prefix = f"{base_slug}-"
    if not slug.startswith(prefix):
        return 0
    suffix = slug[len(prefix) :]
    return int(suffix) - 1 if suffix.isdigit() else 0


async def get_tool_by_slug(db: AsyncSession, slug: str) -> Tool | None:
    result = await db.execute(
        select(Tool).where(Tool.slug == slug).options(selectinload(Tool.seller))
    )
    return result.scalar_one_or_none()


async def get_tool_by_slug_cached(db: AsyncSession, redis: Redis, slug: str) -> Tool | None:
    """Get tool by slug with Redis caching for gateway hot path."""
    cache_key = f"{_TOOL_CACHE_PREFIX}{slug}"
    cached = await redis.get(cache_key)
    if cached:
        data = json.loads(cached)
        if data is None:
            return None
        result = await db.execute(
            select(Tool).where(Tool.id == uuid.UUID(data["id"])).options(selectinload(Tool.seller))
        )
        return result.scalar_one_or_none()

    tool = await get_tool_by_slug(db, slug)
    if tool:
        await redis.set(cache_key, json.dumps({"id": str(tool.id)}), ex=_TOOL_CACHE_TTL)
    else:
        await redis.set(cache_key, "null", ex=_TOOL_CACHE_TTL)
    return tool


async def invalidate_tool_cache(redis: Redis, slug: str) -> None:
    await redis.delete(f"{_TOOL_CACHE_PREFIX}{slug}")


async def get_tool_by_id(db: AsyncSession, tool_id: uuid.UUID) -> Tool | None:
    result = await db.execute(
        select(Tool).where(Tool.id == tool_id).options(selectinload(Tool.seller))
    )
    return result.scalar_one_or_none()


async def get_tool_for_seller(
    db: AsyncSession, tool_id: uuid.UUID, seller_id: uuid.UUID
) -> Tool | None:
    result = await db.execute(
        select(Tool)
        .where(
            Tool.id == tool_id,
            Tool.seller_id == seller_id,
        )
        .options(selectinload(Tool.seller))
    )
    return result.scalar_one_or_none()


async def list_live_tools(
    db: AsyncSession,
    filters: ToolFilters,
    page: int,
    limit: int,
) -> tuple[list[Tool], int]:
    """
    Return a page of live tools matching *filters*, plus the total count.
    """
    availability_conditions = public_availability_conditions()
    base_query = select(Tool).where(*availability_conditions).options(selectinload(Tool.seller))
    count_query = select(func.count()).select_from(Tool).where(*availability_conditions)
    effective_price = _effective_price_expression()

    # --- filters ---
    if filters.category is not None:
        base_query = base_query.where(Tool.category == filters.category)
        count_query = count_query.where(Tool.category == filters.category)

    if filters.min_price is not None:
        base_query = base_query.where(effective_price >= filters.min_price)
        count_query = count_query.where(effective_price >= filters.min_price)

    if filters.max_price is not None:
        base_query = base_query.where(effective_price <= filters.max_price)
        count_query = count_query.where(effective_price <= filters.max_price)

    if filters.search:
        pattern = f"%{filters.search}%"
        search_clause = or_(
            Tool.name.ilike(pattern),
            Tool.tagline.ilike(pattern),
            Tool.description.ilike(pattern),
        )
        base_query = base_query.where(search_clause)
        count_query = count_query.where(search_clause)

    if filters.is_featured is not None:
        base_query = base_query.where(Tool.is_featured == filters.is_featured)
        count_query = count_query.where(Tool.is_featured == filters.is_featured)

    # --- sorting ---
    order = {
        "popular": Tool.total_requests.desc(),
        "newest": Tool.created_at.desc(),
        "price_low": effective_price.asc(),
        "price_high": effective_price.desc(),
    }
    base_query = base_query.order_by(order[filters.sort_by])

    # --- pagination ---
    offset = (page - 1) * limit
    base_query = base_query.offset(offset).limit(limit)

    items_result = await db.execute(base_query)
    total_result = await db.execute(count_query)

    return list(items_result.scalars()), total_result.scalar_one()


async def get_marketplace_stats(db: AsyncSession) -> dict[str, int | float | None]:
    """Return live, database-backed aggregates for public marketplace copy."""
    availability_conditions = public_availability_conditions()
    live_tools = select(func.count(Tool.id)).where(*availability_conditions).scalar_subquery()
    active_sellers = (
        select(func.count(func.distinct(Tool.seller_id)))
        .where(*availability_conditions)
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            live_tools.label("live_tools"),
            active_sellers.label("active_sellers"),
            func.count(UsageLog.id).label("api_calls_served"),
            func.avg(UsageLog.response_time_ms).label("avg_response_time_ms"),
        ).select_from(UsageLog)
    )
    row = result.one()
    return {
        "live_tools": int(row.live_tools or 0),
        "active_sellers": int(row.active_sellers or 0),
        "api_calls_served": int(row.api_calls_served or 0),
        "avg_response_time_ms": (
            float(row.avg_response_time_ms) if row.avg_response_time_ms is not None else None
        ),
    }


async def get_marketplace_stats_cached(
    db: AsyncSession,
    redis: Redis,
) -> dict[str, int | float | None]:
    """Cache aggregate scans briefly while preserving a database fallback."""
    try:
        cached = await redis.get(_MARKETPLACE_STATS_CACHE_KEY)
    except RedisError:
        logger.warning("Marketplace stats cache read failed", exc_info=True)
        cached = None

    if cached:
        try:
            payload = json.loads(cached)
            return {
                "live_tools": int(payload["live_tools"]),
                "active_sellers": int(payload["active_sellers"]),
                "api_calls_served": int(payload["api_calls_served"]),
                "avg_response_time_ms": (
                    float(payload["avg_response_time_ms"])
                    if payload["avg_response_time_ms"] is not None
                    else None
                ),
            }
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            logger.warning("Ignoring malformed marketplace stats cache entry")

    stats = await get_marketplace_stats(db)
    try:
        await redis.set(
            _MARKETPLACE_STATS_CACHE_KEY,
            json.dumps(stats),
            ex=_MARKETPLACE_STATS_CACHE_TTL,
        )
    except RedisError:
        logger.warning("Marketplace stats cache write failed", exc_info=True)
    return stats


async def get_seller_tools(db: AsyncSession, seller_id: uuid.UUID) -> list[Tool]:
    """Return all tools for a seller regardless of status, newest first."""
    result = await db.execute(
        select(Tool)
        .where(Tool.seller_id == seller_id)
        .options(selectinload(Tool.seller))
        .order_by(Tool.created_at.desc())
    )
    return list(result.scalars())


async def list_admin_tools(
    db: AsyncSession,
    status_filter: ToolStatus | None,
    page: int,
    limit: int,
) -> tuple[list[Tool], int]:
    """Return review/admin-visible tools across sellers, newest first."""
    base_query = select(Tool).options(selectinload(Tool.seller))
    count_query = select(func.count()).select_from(Tool)

    if status_filter is not None:
        base_query = base_query.where(Tool.status == status_filter)
        count_query = count_query.where(Tool.status == status_filter)

    offset = (page - 1) * limit
    base_query = base_query.order_by(Tool.created_at.desc()).offset(offset).limit(limit)

    items_result = await db.execute(base_query)
    total_result = await db.execute(count_query)
    return list(items_result.scalars()), total_result.scalar_one()


async def update_tool(
    db: AsyncSession,
    tool: Tool,
    data: SellerToolUpdate | ToolUpdate,
    redis: Redis | None = None,
) -> Tool:
    """Apply only the fields explicitly provided in *data*."""
    updates = data.model_dump(exclude_unset=True)
    ownership_type = OwnershipType(updates.get("ownership_type", tool.ownership_type))
    updates = _normalize_price_fields(ownership_type, updates)
    for field, value in updates.items():
        setattr(tool, field, value)
    await db.commit()
    if redis:
        await invalidate_tool_cache(redis, tool.slug)
    result = await db.execute(
        select(Tool).where(Tool.id == tool.id).options(selectinload(Tool.seller))
    )
    return result.scalar_one()


async def update_tool_review_status(
    db: AsyncSession,
    tool: Tool,
    *,
    status: ToolStatus,
    processing_error: str | None = None,
    is_featured: bool | None = None,
    redis: Redis | None = None,
) -> Tool:
    """Apply an admin review decision to a tool and invalidate public caches."""
    tool.status = status
    tool.processing_error = processing_error
    if is_featured is not None:
        tool.is_featured = is_featured
    await db.commit()
    if redis:
        await invalidate_tool_cache(redis, tool.slug)
    result = await db.execute(
        select(Tool).where(Tool.id == tool.id).options(selectinload(Tool.seller))
    )
    return result.scalar_one()


async def pause_tool(db: AsyncSession, tool: Tool, redis: Redis | None = None) -> Tool:
    """Set the tool status to 'paused' (soft-delete equivalent)."""
    tool.status = ToolStatus.paused
    await db.commit()
    if redis:
        await invalidate_tool_cache(redis, tool.slug)
    await db.refresh(tool)
    return tool
