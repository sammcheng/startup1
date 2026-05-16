import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.tool import ToolStatus


class SellerRevenuePoint(BaseModel):
    date: date
    amount: Decimal


class SellerRequestsPoint(BaseModel):
    date: date
    count: int


class SellerToolSummary(BaseModel):
    tool_id: uuid.UUID
    tool_name: str
    slug: str
    status: ToolStatus
    requests_this_month: int
    revenue_this_month: Decimal
    avg_response_time_ms: float | None = None


class SellerTopTool(BaseModel):
    tool_id: uuid.UUID
    tool_name: str
    revenue_this_month: Decimal


class SellerDashboardResponse(BaseModel):
    total_tools: int
    total_revenue_all_time: Decimal
    total_revenue_this_month: Decimal
    previous_month_revenue: Decimal
    total_requests_this_month: int
    active_tools: int
    avg_response_time_ms: float | None = None
    top_tool: SellerTopTool | None = None
    revenue_chart_data: list[SellerRevenuePoint]
    tools: list[SellerToolSummary]


class SellerErrorSummary(BaseModel):
    error_message: str
    count: int


class SellerErrorLogItem(BaseModel):
    timestamp: datetime
    error_message: str | None = None
    status_code: int
    input_size_bytes: int
    output_size_bytes: int
    response_time_ms: int


class SellerAnalyticsResponse(BaseModel):
    period: str
    requests_over_time: list[SellerRequestsPoint]
    revenue_over_time: list[SellerRevenuePoint]
    unique_users: int
    avg_response_time_ms: float | None = None
    error_rate: float
    top_errors: list[SellerErrorSummary]
    geographic_distribution: list[dict[str, str | int]]
    p50_response_time_ms: float | None = None
    p95_response_time_ms: float | None = None
    p99_response_time_ms: float | None = None
    recent_errors: list[SellerErrorLogItem]
