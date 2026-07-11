from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    APIKey,
    Tool,
    ToolPurchase,
    ToolStatus,
    Transaction,
    TransactionStatus,
    UsageLog,
    User,
)
from app.models.tool_purchase import PurchaseStatus
from app.schemas.dashboard import (
    DashboardActivityItem,
    DashboardPurchasedTool,
    DashboardStatSummary,
    DashboardSummaryResponse,
    DashboardUsagePoint,
)


async def get_dashboard_summary(db: AsyncSession, user: User) -> DashboardSummaryResponse:
    month_start = _month_start(datetime.now(UTC))

    total_api_calls = await _count_api_calls(db, user.id, month_start)
    total_spend = await _sum_transaction_amount(
        db, Transaction.buyer_id == user.id, month_start, "amount"
    )
    total_earned = await _sum_transaction_amount(
        db, Transaction.seller_id == user.id, month_start, "seller_payout"
    )
    active_tools = await _count_active_tools(db, user.id)
    active_api_keys = await _count_active_api_keys(db, user.id)
    purchased_tools = await _purchased_tools(db, user.id, month_start)
    recent_activity = await _recent_activity(db, user.id)
    usage_chart_data = await _usage_chart(db, user.id, month_start)

    return DashboardSummaryResponse(
        display_name=user.display_name,
        role=user.role.value,
        stats=DashboardStatSummary(
            total_api_calls_this_month=total_api_calls,
            total_spend_this_month=total_spend,
            total_earned_this_month=total_earned,
            active_tools=active_tools,
        ),
        active_api_keys=active_api_keys,
        purchased_tools=purchased_tools,
        recent_activity=recent_activity,
        usage_chart_data=usage_chart_data,
    )


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def _count_api_calls(db: AsyncSession, user_id, month_start: datetime) -> int:
    result = await db.execute(
        select(func.count(UsageLog.id)).where(
            UsageLog.user_id == user_id,
            UsageLog.request_timestamp >= month_start,
        )
    )
    return int(result.scalar() or 0)


async def _sum_transaction_amount(
    db: AsyncSession, owner_filter, month_start: datetime, field_name: str
) -> Decimal:
    field = getattr(Transaction, field_name)
    result = await db.execute(
        select(func.coalesce(func.sum(field), 0)).where(
            owner_filter,
            Transaction.status == TransactionStatus.completed,
            Transaction.created_at >= month_start,
        )
    )
    return Decimal(result.scalar() or 0)


async def _count_active_tools(db: AsyncSession, seller_id) -> int:
    result = await db.execute(
        select(func.count(Tool.id)).where(
            Tool.seller_id == seller_id,
            Tool.status == ToolStatus.live,
        )
    )
    return int(result.scalar() or 0)


async def _count_active_api_keys(db: AsyncSession, user_id) -> int:
    result = await db.execute(
        select(func.count(APIKey.id)).where(
            APIKey.user_id == user_id,
            APIKey.is_active.is_(True),
        )
    )
    return int(result.scalar() or 0)


async def _purchased_tools(
    db: AsyncSession, user_id, month_start: datetime
) -> list[DashboardPurchasedTool]:
    active_purchases = (
        select(ToolPurchase.tool_id)
        .where(
            ToolPurchase.buyer_id == user_id,
            ToolPurchase.status == PurchaseStatus.active,
        )
        .subquery()
    )

    result = await db.execute(
        select(
            Tool.id,
            Tool.name,
            Tool.slug,
            Tool.category,
            func.count(UsageLog.id).label("calls_this_month"),
            func.coalesce(func.sum(UsageLog.cost), 0).label("spend_this_month"),
            func.max(UsageLog.request_timestamp).label("last_used_at"),
        )
        .join(active_purchases, active_purchases.c.tool_id == Tool.id)
        .outerjoin(
            UsageLog,
            (UsageLog.tool_id == Tool.id)
            & (UsageLog.user_id == user_id)
            & (UsageLog.request_timestamp >= month_start),
        )
        .group_by(Tool.id, Tool.name, Tool.slug, Tool.category)
        .order_by(func.max(UsageLog.request_timestamp).desc().nullslast(), Tool.name.asc())
        .limit(20)
    )

    return [
        DashboardPurchasedTool(
            tool_id=row.id,
            tool_name=row.name,
            slug=row.slug,
            category=row.category.value if hasattr(row.category, "value") else str(row.category),
            calls_this_month=int(row.calls_this_month or 0),
            spend_this_month=Decimal(row.spend_this_month or 0),
            last_used_at=row.last_used_at,
        )
        for row in result.all()
    ]


async def _recent_activity(db: AsyncSession, user_id) -> list[DashboardActivityItem]:
    result = await db.execute(
        select(UsageLog, Tool.name)
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(UsageLog.user_id == user_id)
        .order_by(UsageLog.request_timestamp.desc())
        .limit(10)
    )

    activity: list[DashboardActivityItem] = []
    for usage_log, tool_name in result.all():
        activity.append(
            DashboardActivityItem(
                id=usage_log.id,
                tool_id=usage_log.tool_id,
                tool_name=tool_name,
                request_timestamp=usage_log.request_timestamp,
                status_code=usage_log.status_code,
                response_time_ms=usage_log.response_time_ms,
                cost=usage_log.cost,
                error_message=usage_log.error_message,
            )
        )
    return activity


async def _usage_chart(
    db: AsyncSession, user_id, month_start: datetime
) -> list[DashboardUsagePoint]:
    call_rows = await db.execute(
        select(
            func.date(UsageLog.request_timestamp).label("day"),
            func.count(UsageLog.id).label("calls"),
        )
        .where(
            UsageLog.user_id == user_id,
            UsageLog.request_timestamp >= month_start,
        )
        .group_by(func.date(UsageLog.request_timestamp))
    )
    spend_rows = await db.execute(
        select(
            func.date(Transaction.created_at).label("day"),
            func.coalesce(func.sum(Transaction.amount), 0).label("spend"),
        )
        .where(
            Transaction.buyer_id == user_id,
            Transaction.status == TransactionStatus.completed,
            Transaction.created_at >= month_start,
        )
        .group_by(func.date(Transaction.created_at))
    )

    points: dict = {}
    for row in call_rows.all():
        points[row.day] = {"calls": int(row.calls or 0), "spend": Decimal("0")}
    for row in spend_rows.all():
        point = points.setdefault(row.day, {"calls": 0, "spend": Decimal("0")})
        point["spend"] = Decimal(row.spend or 0)

    return [
        DashboardUsagePoint(date=day, calls=values["calls"], spend=values["spend"])
        for day, values in sorted(points.items())
    ]
