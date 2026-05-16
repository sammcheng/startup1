from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tool, ToolStatus, Transaction, TransactionStatus, UsageLog, User
from app.schemas.dashboard import DashboardActivityItem, DashboardStatSummary, DashboardSummaryResponse


async def get_dashboard_summary(db: AsyncSession, user: User) -> DashboardSummaryResponse:
    month_start = _month_start(datetime.now(timezone.utc))

    total_api_calls = await _count_api_calls(db, user.id, month_start)
    total_spend = await _sum_transaction_amount(db, Transaction.buyer_id == user.id, month_start, "amount")
    total_earned = await _sum_transaction_amount(db, Transaction.seller_id == user.id, month_start, "seller_payout")
    active_tools = await _count_active_tools(db, user.id)
    recent_activity = await _recent_activity(db, user.id)

    return DashboardSummaryResponse(
        display_name=user.display_name,
        role=user.role.value,
        stats=DashboardStatSummary(
            total_api_calls_this_month=total_api_calls,
            total_spend_this_month=total_spend,
            total_earned_this_month=total_earned,
            active_tools=active_tools,
        ),
        recent_activity=recent_activity,
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


async def _sum_transaction_amount(db: AsyncSession, owner_filter, month_start: datetime, field_name: str) -> Decimal:
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
