import logging
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import Float, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tool, UsageLog
from app.schemas.usage import (
    Granularity,
    UsageLogCreate,
    UsageSummaryResponse,
    UsageTimeBucket,
    UsageToolBreakdown,
)

logger = logging.getLogger(__name__)


def normalize_date_range(
    start_date: date | None, end_date: date | None
) -> tuple[date, date, datetime, datetime]:
    today = datetime.now(UTC).date()
    effective_end = end_date or today
    effective_start = start_date or (effective_end - timedelta(days=29))
    start_dt = datetime.combine(effective_start, time.min, tzinfo=UTC)
    end_dt = datetime.combine(effective_end + timedelta(days=1), time.min, tzinfo=UTC)
    return effective_start, effective_end, start_dt, end_dt


async def persist_usage_log(
    db: AsyncSession,
    usage_log_id: uuid.UUID,
    entry: UsageLogCreate,
) -> bool:
    """Persist one invocation once, even when a queued retry races the API."""
    log = UsageLog(id=usage_log_id, **entry.model_dump())
    db.add(log)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            existing = await db.get(UsageLog, usage_log_id)
        except Exception:
            raise
        if existing is not None:
            return False
        raise
    return True


async def get_usage_summary_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    start_date: date | None,
    end_date: date | None,
    tool_id: uuid.UUID | None,
    granularity: Granularity,
) -> UsageSummaryResponse:
    effective_start, effective_end, start_dt, end_dt = normalize_date_range(start_date, end_date)
    filters = [
        UsageLog.user_id == user_id,
        UsageLog.request_timestamp >= start_dt,
        UsageLog.request_timestamp < end_dt,
    ]
    if tool_id:
        filters.append(UsageLog.tool_id == tool_id)

    return await _build_summary(
        db, filters, granularity, effective_start, effective_end, include_unique_users=False
    )


async def get_usage_summary_for_tool(
    db: AsyncSession,
    tool_id: uuid.UUID,
    start_date: date | None,
    end_date: date | None,
    granularity: Granularity,
) -> UsageSummaryResponse:
    effective_start, effective_end, start_dt, end_dt = normalize_date_range(start_date, end_date)
    filters = [
        UsageLog.tool_id == tool_id,
        UsageLog.request_timestamp >= start_dt,
        UsageLog.request_timestamp < end_dt,
    ]

    return await _build_summary(
        db, filters, granularity, effective_start, effective_end, include_unique_users=True
    )


async def _build_summary(
    db: AsyncSession,
    filters: list,
    granularity: Granularity,
    start_date: date,
    end_date: date,
    include_unique_users: bool,
) -> UsageSummaryResponse:
    period = func.date_trunc(granularity, UsageLog.request_timestamp)

    summary_result = await db.execute(
        select(
            func.count(UsageLog.id),
            func.coalesce(func.sum(UsageLog.cost), 0),
            func.avg(cast(UsageLog.response_time_ms, Float)),
            func.count(func.distinct(UsageLog.user_id)),
        ).where(*filters)
    )
    total_requests, total_cost, avg_response_time, unique_users = summary_result.one()

    bucket_columns = [
        period.label("period_start"),
        UsageLog.tool_id,
        Tool.name.label("tool_name"),
        func.count(UsageLog.id).label("total_requests"),
        func.coalesce(func.sum(UsageLog.cost), 0).label("total_cost"),
        func.avg(cast(UsageLog.response_time_ms, Float)).label("avg_response_time"),
    ]
    if include_unique_users:
        bucket_columns.extend(
            [
                func.count(func.distinct(UsageLog.user_id)).label("unique_users"),
                func.coalesce(func.sum(UsageLog.cost), 0).label("total_revenue"),
            ]
        )

    bucket_result = await db.execute(
        select(*bucket_columns)
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(*filters)
        .group_by(period, UsageLog.tool_id, Tool.name)
        .order_by(period.asc(), Tool.name.asc())
    )

    buckets: list[UsageTimeBucket] = []
    for row in bucket_result.all():
        buckets.append(
            UsageTimeBucket(
                period_start=row.period_start,
                tool_id=row.tool_id,
                tool_name=row.tool_name,
                total_requests=int(row.total_requests or 0),
                total_cost=Decimal(row.total_cost or 0),
                avg_response_time=float(row.avg_response_time)
                if row.avg_response_time is not None
                else None,
                unique_users=int(row.unique_users)
                if include_unique_users and row.unique_users is not None
                else None,
                total_revenue=Decimal(row.total_revenue or 0) if include_unique_users else None,
            )
        )

    tool_columns = [
        UsageLog.tool_id,
        Tool.name.label("tool_name"),
        func.count(UsageLog.id).label("total_requests"),
        func.coalesce(func.sum(UsageLog.cost), 0).label("total_cost"),
    ]
    if include_unique_users:
        tool_columns.append(func.coalesce(func.sum(UsageLog.cost), 0).label("total_revenue"))

    tool_result = await db.execute(
        select(*tool_columns)
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(*filters)
        .group_by(UsageLog.tool_id, Tool.name)
        .order_by(func.count(UsageLog.id).desc(), Tool.name.asc())
    )

    by_tool: list[UsageToolBreakdown] = []
    for row in tool_result.all():
        by_tool.append(
            UsageToolBreakdown(
                tool_id=row.tool_id,
                tool_name=row.tool_name,
                total_requests=int(row.total_requests or 0),
                total_cost=Decimal(row.total_cost or 0),
                total_revenue=Decimal(row.total_revenue or 0) if include_unique_users else None,
            )
        )

    return UsageSummaryResponse(
        granularity=granularity,
        start_date=start_date,
        end_date=end_date,
        total_requests=int(total_requests or 0),
        total_cost=Decimal(total_cost or 0),
        avg_response_time=float(avg_response_time) if avg_response_time is not None else None,
        total_revenue=Decimal(total_cost or 0) if include_unique_users else None,
        unique_users=int(unique_users or 0) if include_unique_users else None,
        buckets=buckets,
        by_tool=by_tool,
    )
