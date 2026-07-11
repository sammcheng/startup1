import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tool, ToolStatus, Transaction, TransactionStatus, UsageLog
from app.schemas.seller import (
    SellerActivityItem,
    SellerAnalyticsResponse,
    SellerDashboardResponse,
    SellerErrorLogItem,
    SellerErrorSummary,
    SellerLatencyPoint,
    SellerRequestsPoint,
    SellerRevenuePoint,
    SellerToolSummary,
    SellerTopTool,
)
from app.services import job_service


async def get_seller_dashboard(db: AsyncSession, seller_id: uuid.UUID) -> SellerDashboardResponse:
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous_month_end = month_start
    previous_month_start = (month_start - timedelta(days=1)).replace(day=1)
    chart_start = (now - timedelta(days=89)).replace(hour=0, minute=0, second=0, microsecond=0)

    total_tools_result = await db.execute(
        select(
            func.count(Tool.id),
            func.sum(case((Tool.status == ToolStatus.live, 1), else_=0)),
        ).where(Tool.seller_id == seller_id)
    )
    total_tools, active_tools = total_tools_result.one()

    total_revenue_all_time = await _sum_seller_revenue(db, seller_id)
    total_revenue_this_month = await _sum_seller_revenue(db, seller_id, month_start, now)
    previous_month_revenue = await _sum_seller_revenue(
        db, seller_id, previous_month_start, previous_month_end
    )
    total_requests_this_month = await _count_seller_requests(db, seller_id, month_start, now)
    avg_response_time_ms = await _avg_response_time(db, seller_id, month_start, now)

    revenue_chart_rows = await db.execute(
        select(
            func.date(Transaction.created_at).label("day"),
            func.coalesce(func.sum(Transaction.seller_payout), 0).label("amount"),
        )
        .where(
            Transaction.seller_id == seller_id,
            Transaction.status == TransactionStatus.completed,
            Transaction.created_at >= chart_start,
        )
        .group_by(func.date(Transaction.created_at))
        .order_by(func.date(Transaction.created_at).asc())
    )
    revenue_chart_data = [
        SellerRevenuePoint(date=row.day, amount=Decimal(row.amount or 0))
        for row in revenue_chart_rows.all()
    ]

    request_chart_rows = await db.execute(
        select(
            func.date(UsageLog.request_timestamp).label("day"),
            func.count(UsageLog.id).label("count"),
            func.avg(UsageLog.response_time_ms).label("avg_response_time_ms"),
        )
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(
            Tool.seller_id == seller_id,
            UsageLog.request_timestamp >= chart_start,
        )
        .group_by(func.date(UsageLog.request_timestamp))
        .order_by(func.date(UsageLog.request_timestamp).asc())
    )
    request_chart_records = request_chart_rows.all()
    request_chart_data = [
        SellerRequestsPoint(date=row.day, count=int(row.count or 0))
        for row in request_chart_records
    ]
    latency_chart_data = [
        SellerLatencyPoint(
            date=row.day,
            avg_response_time_ms=float(row.avg_response_time_ms),
        )
        for row in request_chart_records
        if row.avg_response_time_ms is not None
    ]

    tool_revenue_rows = await db.execute(
        select(
            Transaction.tool_id,
            func.coalesce(func.sum(Transaction.seller_payout), 0).label("revenue"),
        )
        .where(
            Transaction.seller_id == seller_id,
            Transaction.status == TransactionStatus.completed,
            Transaction.created_at >= month_start,
            Transaction.created_at < now,
        )
        .group_by(Transaction.tool_id)
    )
    revenue_by_tool = {row.tool_id: Decimal(row.revenue or 0) for row in tool_revenue_rows.all()}

    tool_rows = await db.execute(
        select(
            Tool.id,
            Tool.name,
            Tool.slug,
            Tool.status,
            Tool.uptime_percentage,
            Tool.created_at,
            func.count(UsageLog.id).label("requests_this_month"),
            func.count(func.distinct(UsageLog.user_id)).label("unique_users_this_month"),
            func.avg(UsageLog.response_time_ms).label("avg_response_time_ms"),
            func.percentile_cont(0.50)
            .within_group(UsageLog.response_time_ms)
            .label("p50_response_time_ms"),
            func.percentile_cont(0.95)
            .within_group(UsageLog.response_time_ms)
            .label("p95_response_time_ms"),
            func.percentile_cont(0.99)
            .within_group(UsageLog.response_time_ms)
            .label("p99_response_time_ms"),
        )
        .select_from(Tool)
        .outerjoin(
            UsageLog,
            (UsageLog.tool_id == Tool.id)
            & (UsageLog.request_timestamp >= month_start)
            & (UsageLog.request_timestamp < now),
        )
        .where(Tool.seller_id == seller_id)
        .group_by(
            Tool.id,
            Tool.name,
            Tool.slug,
            Tool.status,
            Tool.uptime_percentage,
            Tool.created_at,
        )
        .order_by(Tool.created_at.desc())
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
                revenue_this_month=revenue_by_tool.get(row.id, Decimal("0")),
                unique_users_this_month=int(row.unique_users_this_month or 0),
                avg_response_time_ms=float(row.avg_response_time_ms)
                if row.avg_response_time_ms is not None
                else None,
                p50_response_time_ms=float(row.p50_response_time_ms)
                if row.p50_response_time_ms is not None
                else None,
                p95_response_time_ms=float(row.p95_response_time_ms)
                if row.p95_response_time_ms is not None
                else None,
                p99_response_time_ms=float(row.p99_response_time_ms)
                if row.p99_response_time_ms is not None
                else None,
                uptime_percentage=Decimal(row.uptime_percentage)
                if row.uptime_percentage is not None
                else None,
            )
        )

    tools.sort(
        key=lambda tool: (tool.revenue_this_month, tool.requests_this_month),
        reverse=True,
    )
    top_tool = (
        SellerTopTool(
            tool_id=tools[0].tool_id,
            tool_name=tools[0].tool_name,
            revenue_this_month=tools[0].revenue_this_month,
        )
        if tools and tools[0].revenue_this_month > 0
        else None
    )

    recent_activity_rows = await db.execute(
        select(
            UsageLog.id,
            UsageLog.tool_id,
            Tool.name.label("tool_name"),
            UsageLog.request_timestamp,
            UsageLog.status_code,
            UsageLog.response_time_ms,
            UsageLog.cost,
            UsageLog.error_message,
        )
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(Tool.seller_id == seller_id)
        .order_by(UsageLog.request_timestamp.desc())
        .limit(12)
    )
    recent_activity = [
        SellerActivityItem(
            id=row.id,
            tool_id=row.tool_id,
            tool_name=row.tool_name,
            request_timestamp=row.request_timestamp,
            status_code=row.status_code,
            response_time_ms=row.response_time_ms,
            cost=Decimal(row.cost or 0),
            error_message=row.error_message,
        )
        for row in recent_activity_rows.all()
    ]

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
        request_chart_data=request_chart_data,
        latency_chart_data=latency_chart_data,
        recent_activity=recent_activity,
        tools=tools,
    )


async def get_tool_analytics(
    db: AsyncSession, tool_id: uuid.UUID, period: str
) -> SellerAnalyticsResponse:
    now = datetime.now(UTC)
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
        SellerRequestsPoint(date=row.day, count=int(row.count or 0)) for row in request_rows.all()
    ]

    revenue_rows = await db.execute(
        select(
            func.date(Transaction.created_at).label("day"),
            func.coalesce(func.sum(Transaction.seller_payout), 0).label("amount"),
        )
        .where(
            Transaction.tool_id == tool_id,
            Transaction.status == TransactionStatus.completed,
            Transaction.created_at >= start,
        )
        .group_by(func.date(Transaction.created_at))
        .order_by(func.date(Transaction.created_at).asc())
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

    percentile_result = await db.execute(
        select(
            func.percentile_cont(0.50).within_group(UsageLog.response_time_ms),
            func.percentile_cont(0.95).within_group(UsageLog.response_time_ms),
            func.percentile_cont(0.99).within_group(UsageLog.response_time_ms),
        ).where(UsageLog.tool_id == tool_id, UsageLog.request_timestamp >= start)
    )
    p50_response_time_ms, p95_response_time_ms, p99_response_time_ms = percentile_result.one()

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
        avg_response_time_ms=float(avg_response_time_ms)
        if avg_response_time_ms is not None
        else None,
        error_rate=error_rate,
        top_errors=top_errors,
        geographic_distribution=[],
        p50_response_time_ms=float(p50_response_time_ms)
        if p50_response_time_ms is not None
        else None,
        p95_response_time_ms=float(p95_response_time_ms)
        if p95_response_time_ms is not None
        else None,
        p99_response_time_ms=float(p99_response_time_ms)
        if p99_response_time_ms is not None
        else None,
        recent_errors=recent_errors,
    )


async def _sum_seller_revenue(
    db: AsyncSession,
    seller_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
) -> Decimal:
    conditions = [
        Transaction.seller_id == seller_id,
        Transaction.status == TransactionStatus.completed,
    ]
    if start is not None:
        conditions.append(Transaction.created_at >= start)
    if end is not None:
        conditions.append(Transaction.created_at < end)
    result = await db.execute(
        select(func.coalesce(func.sum(Transaction.seller_payout), 0)).where(*conditions)
    )
    return Decimal(result.scalar() or 0)


async def _count_seller_requests(
    db: AsyncSession, seller_id: uuid.UUID, start: datetime, end: datetime
) -> int:
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


async def _avg_response_time(
    db: AsyncSession, seller_id: uuid.UUID, start: datetime, end: datetime
) -> float | None:
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
        return datetime(1970, 1, 1, tzinfo=UTC)
    return now - timedelta(days=30)
