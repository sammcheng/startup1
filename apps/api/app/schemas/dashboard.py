import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class DashboardStatSummary(BaseModel):
    total_api_calls_this_month: int
    total_spend_this_month: Decimal
    total_earned_this_month: Decimal
    active_tools: int


class DashboardActivityItem(BaseModel):
    id: uuid.UUID
    tool_id: uuid.UUID
    tool_name: str
    request_timestamp: datetime
    status_code: int
    response_time_ms: int
    cost: Decimal
    error_message: str | None = None


class DashboardPurchasedTool(BaseModel):
    tool_id: uuid.UUID
    tool_name: str
    slug: str
    category: str
    calls_this_month: int
    spend_this_month: Decimal
    last_used_at: datetime | None = None


class DashboardSummaryResponse(BaseModel):
    display_name: str
    role: str
    stats: DashboardStatSummary
    active_api_keys: int
    purchased_tools: list[DashboardPurchasedTool]
    recent_activity: list[DashboardActivityItem]
