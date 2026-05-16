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


class DashboardSummaryResponse(BaseModel):
    display_name: str
    role: str
    stats: DashboardStatSummary
    recent_activity: list[DashboardActivityItem]
