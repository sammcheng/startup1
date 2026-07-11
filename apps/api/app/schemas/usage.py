import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

Granularity = Literal["hour", "day", "month"]


class UsageTimeBucket(BaseModel):
    period_start: datetime
    tool_id: uuid.UUID
    tool_name: str
    total_requests: int
    total_cost: Decimal
    avg_response_time: float | None = None
    unique_users: int | None = None
    total_revenue: Decimal | None = None


class UsageToolBreakdown(BaseModel):
    tool_id: uuid.UUID
    tool_name: str
    total_requests: int
    total_cost: Decimal
    total_revenue: Decimal | None = None


class UsageSummaryResponse(BaseModel):
    granularity: Granularity
    start_date: date
    end_date: date
    total_requests: int
    total_cost: Decimal
    avg_response_time: float | None = None
    total_revenue: Decimal | None = None
    unique_users: int | None = None
    buckets: list[UsageTimeBucket]
    by_tool: list[UsageToolBreakdown]


class UsageLogCreate(BaseModel):
    api_key_id: uuid.UUID
    tool_id: uuid.UUID
    user_id: uuid.UUID
    request_timestamp: datetime
    response_time_ms: int
    status_code: int
    input_size_bytes: int
    output_size_bytes: int
    cost: Decimal
    error_message: str | None = None
