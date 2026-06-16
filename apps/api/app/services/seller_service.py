import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tool, ToolStatus, Transaction, TransactionStatus, UsageLog
from app.schemas.seller import (
    SellerAnalyticsResponse,
    SellerDashboardResponse,
    SellerErrorLogItem,
    SellerErrorSummary,
    SellerRequestsPoint,
    SellerRevenuePoint,
    SellerToolSummary,
    SellerTopTool,
)
from app.services import job_service


async def get_seller_dashboard(db: AsyncSession, seller_id: uuid.UUID) -> SellerDashboardResponse:
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous_month_end = month_start
    previous_month_start = (month_start - timedelta(days=1)).replace(day=1)
    chart_start = (now - timedelta(days=29)).date()

    total_tools_result = await db.execute(
        select(
            func.count(Tool.id),
            func.sum(case((Tool.status == ToolStatus.live, 1), else_=0)),
        ).where(Tool.seller_id == seller_id)
    )
    total_tools, active_tools = total_tools_result.one()

    total_revenue_all_time = await _sum_seller_revenue(db, seller_id)
    total_revenue_this_month = await _sum_seller_revenue(db, seller_id, month_start, now)
    previous_month_revenue = await _sum_seller_revenue(db, seller_id, previous_month_start, previous_month_end)
    total_requests_this_month = await _count_seller_requests(db, seller_id, month_start, now)
    avg_response_time_ms = await _avg_response_time(db, seller_id, month_start, now)

    revenue_chart_rows = await db.execute(
        select(
            func.date(UsageLog.request_timestamp).label("day"),
            func.coalesce(func.sum(UsageLog.cost), 0).label("amount"),
        )
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(
            Tool.seller_id == seller_id,
            UsageLog.request_timestamp >= datetime.combine(chart_start, datetime.min.time(), tzinfo=timezone.utc),
        )
        .group_by(func.date(UsageLog.request_timestamp))
        .order_by(func.date(UsageLog.request_timestamp).asc())
    )
    revenue_chart_data = [
        SellerRevenuePoint(date=row.day, amount=Decimal(row.amount or 0))
        for row in revenue_chart_rows.all()
    ]

    top_tool_rows = await db.execute(
        select(
            Tool.id,
            Tool.name,
            func.coalesce(func.sum(UsageLog.cost), 0).label("revenue"),
        )
        .join(UsageLog, UsageLog.tool_id == Tool.id)
        .where(
            Tool.seller_id == seller_id,
            UsageLog.request_timestamp >= month_start,
            UsageLog.request_timestamp < now,
        )
        .group_by(Tool.id, Tool.name)
        .order_by(func.coalesce(func.sum(UsageLog.cost), 0).desc())
        .limit(1)
    )
    top_tool_row = top_tool_rows.first()
    top_tool = (
        SellerTopTool(
            tool_id=top_tool_row.id,
            tool_name=top_tool_row.name,
            revenue_this_month=Decimal(top_tool_row.revenue or 0),
        )
        if top_tool_row
        else None
    )

    tool_rows = await db.execute(
        select(
            Tool.id,
            Tool.name,
            Tool.slug,
            Tool.status,
            func.count(UsageLog.id).label("requests_this_month"),
            func.coalesce(func.sum(UsageLog.cost), 0).label("revenue_this_month"),
            func.avg(UsageLog.response_time_ms).label("avg_response_time_ms"),
        )
        .select_from(Tool)
        .outerjoin(
            UsageLog,
            (UsageLog.tool_id == Tool.id) & (UsageLog.request_timestamp >= month_start) & (UsageLog.request_timestamp < now),
        )
        .where(Tool.seller_id == seller_id)
        .group_by(Tool.id, Tool.name, Tool.slug, Tool.status)
        .order_by(func.coalesce(func.sum(UsageLog.cost), 0).desc(), Tool.created_at.desc())
    )
    tool_records = list(tool_rows.all())
    latest_jobs = await job_service.list_latest_tool_jobs(db, [row.id for row in tool_records])
    tools = []
    for row in tool_records:
        latest_job = latest_jobs.get(row.id)
        tools.append(
            SellerToolSummary(
                tool_id=row.id,
                tool_name=row.name,
                slug=row.slug,
                status=row.status,
                latest_job_status=latest_job.status if latest_job else None,
                latest_job_error=latest_job.last_error if latest_job else None,
                requests_this_month=int(row.requests_this_month or 0),
                revenue_this_month=Decimal(row.revenue_this_month or 0),
                avg_response_time_ms=float(row.avg_response_time_ms) if row.avg_response_time_ms is not None else None,
            )
        )

    return SellerDashboardResponse(
        total_tools=int(total_tools or 0),
        total_revenue_all_time=total_revenue_all_time,
        total_revenue_this_month=total_revenue_this_month,
        previous_month_revenue=previous_month_revenue,
        total_requests_this_month=total_requests_this_month,
        active_tools=int(active_tools or 0),
        avg_response_time_ms=avg_response_time_ms,
        top_tool=top_tool,
        revenue_chart_data=revenue_chart_data,
        tools=tools,
    )


async def get_tool_analytics(db: AsyncSession, tool_id: uuid.UUID, period: str) -> SellerAnalyticsResponse:
    now = datetime.now(timezone.utc)
    start = _period_start(period, now)

    request_rows = await db.execute(
        select(
            func.date(UsageLog.request_timestamp).label("day"),
            func.count(UsageLog.id).label("count"),
        )
        .where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= start)
        .group_by(func.date(UsageLog.request_timestamp))
        .order_by(func.date(UsageLog.request_timestamp).asc())
    )
    requests_over_time = [
        SellerRequestsPoint(date=row.day, count=int(row.count or 0))
        for row in request_rows.all()
    ]

    revenue_rows = await db.execute(
        select(
            func.date(UsageLog.request_timestamp).label("day"),
            func.coalesce(func.sum(UsageLog.cost), 0).label("amount"),
        )
        .where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= start)
        .group_by(func.date(UsageLog.request_timestamp))
        .order_by(func.date(UsageLog.request_timestamp).asc())
    )
    revenue_over_time = [
        SellerRevenuePoint(date=row.day, amount=Decimal(row.amount or 0))
        for row in revenue_rows.all()
    ]

    aggregate_result = await db.execute(
        select(
            func.count(UsageLog.id),
            func.count(func.distinct(UsageLog.user_id)),
            func.avg(UsageLog.response_time_ms),
            func.sum(case((UsageLog.status_code >= 400, 1), else_=0)),
        ).where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= start)
    )
    total_requests, unique_users, avg_response_time_ms, error_count = aggregate_result.one()
    total_requests_int = int(total_requests or 0)
    error_rate = (float(error_count or 0) / total_requests_int * 100) if total_requests_int else 0.0

    top_error_rows = await db.execute(
        select(
            func.coalesce(UsageLog.error_message, "HTTP error").label("error_message"),
            func.count(UsageLog.id).label("count"),
        )
        .where(
            UsageLog.tool_id == tool_id,
            UsageLog.request_timestamp >= start,
            UsageLog.status_code >= 400,
        )
        .group_by(func.coalesce(UsageLog.error_message, "HTTP error"))
        .order_by(func.count(UsageLog.id).desc())
        .limit(5)
    )
    top_errors = [
        SellerErrorSummary(error_message=row.error_message, count=int(row.count or 0))
        for row in top_error_rows.all()
    ]

    percentile_rows = await db.execute(
        select(UsageLog.response_time_ms)
        .where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= start)
        .order_by(UsageLog.response_time_ms.asc())
    )
    response_times = [int(row[0]) for row in percentile_rows.all()]

    recent_errors_rows = await db.execute(
        select(
            UsageLog.request_timestamp,
            UsageLog.error_message,
            UsageLog.status_code,
            UsageLog.input_size_bytes,
            UsageLog.output_size_bytes,
            UsageLog.response_time_ms,
        )
        .where(
            UsageLog.tool_id == tool_id,
            UsageLog.request_timestamp >= start,
            UsageLog.status_code >= 400,
        )
        .order_by(UsageLog.request_timestamp.desc())
        .limit(20)
    )
    recent_errors = [
        SellerErrorLogItem(
            timestamp=row.request_timestamp,
            error_message=row.error_message,
            status_code=row.status_code,
            input_size_bytes=row.input_size_bytes,
            output_size_bytes=row.output_size_bytes,
            response_time_ms=row.response_time_ms,
        )
        for row in recent_errors_rows.all()
    ]

    return SellerAnalyticsResponse(
        period=period,
        requests_over_time=requests_over_time,
        revenue_over_time=revenue_over_time,
        unique_users=int(unique_users or 0),
        avg_response_time_ms=float(avg_response_time_ms) if avg_response_time_ms is not None else None,
        error_rate=error_rate,
        top_errors=top_errors,
        geographic_distribution=[],
        p50_response_time_ms=_percentile(response_times, 0.50),
        p95_response_time_ms=_percentile(response_times, 0.95),
        p99_response_time_ms=_percentile(response_times, 0.99),
        recent_errors=recent_errors,
    )


async def _sum_seller_revenue(
    db: AsyncSession,
    seller_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
) -> Decimal:
    conditions = [Transaction.seller_id == seller_id, Transaction.status == TransactionStatus.completed]
    if start is not None:
        conditions.append(Transaction.created_at >= start)
    if end is not None:
        conditions.append(Transaction.created_at < end)
    result = await db.execute(select(func.coalesce(func.sum(Transaction.seller_payout), 0)).where(*conditions))
    return Decimal(result.scalar() or 0)


async def _count_seller_requests(db: AsyncSession, seller_id: uuid.UUID, start: datetime, end: datetime) -> int:
    result = await db.execute(
        select(func.count(UsageLog.id))
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(
            Tool.seller_id == seller_id,
            UsageLog.request_timestamp >= start,
            UsageLog.request_timestamp < end,
        )
    )
    return int(result.scalar() or 0)


async def _avg_response_time(db: AsyncSession, seller_id: uuid.UUID, start: datetime, end: datetime) -> float | None:
    result = await db.execute(
        select(func.avg(UsageLog.response_time_ms))
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(
            Tool.seller_id == seller_id,
            UsageLog.request_timestamp >= start,
            UsageLog.request_timestamp < end,
        )
    )
    value = result.scalar()
    return float(value) if value is not None else None


def _period_start(period: str, now: datetime) -> datetime:
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    if period == "90d":
        return now - timedelta(days=90)
    if period == "all":
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    return now - timedelta(days=30)


def _percentile(values: list[int], ratio: float) -> float | None:
    if not values:
        return None
    index = max(min(int(round((len(values) - 1) * ratio)), len(values) - 1), 0)
    return float(values[index])
