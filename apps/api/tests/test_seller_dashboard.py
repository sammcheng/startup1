import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models import ToolStatus
from app.schemas.seller import SellerDashboardResponse
from app.services import seller_service


class Result:
    def __init__(self, value):
        self.value = value

    def one(self):
        return self.value

    def scalar(self):
        return self.value

    def all(self):
        return self.value


class Session:
    def __init__(self, results):
        self.results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)


def test_seller_dashboard_is_available_to_every_authenticated_account(
    client, auth_overrides, buyer, monkeypatch
):
    auth_overrides(current_user=buyer)

    async def empty_dashboard(db, seller_id):
        assert seller_id == buyer.id
        return SellerDashboardResponse(
            total_tools=0,
            total_revenue_all_time=Decimal("0"),
            total_revenue_this_month=Decimal("0"),
            previous_month_revenue=Decimal("0"),
            total_requests_this_month=0,
            active_tools=0,
            revenue_chart_data=[],
            tools=[],
        )

    monkeypatch.setattr(seller_service, "get_seller_dashboard", empty_dashboard)

    response = client.get("/v1/seller/dashboard")

    assert response.status_code == 200
    assert response.json()["total_tools"] == 0


@pytest.mark.asyncio
async def test_seller_dashboard_uses_measured_percentiles_payouts_and_activity(monkeypatch):
    seller_id = uuid.uuid4()
    tool_id = uuid.uuid4()
    activity_id = uuid.uuid4()
    day = date(2026, 7, 1)
    session = Session(
        [
            Result((1, 1)),
            Result(Decimal("32.00")),
            Result(Decimal("9.50")),
            Result(Decimal("4.00")),
            Result(18),
            Result(87.5),
            Result([SimpleNamespace(day=day, amount=Decimal("9.50"))]),
            Result([SimpleNamespace(day=day, count=18, avg_response_time_ms=87.5)]),
            Result([SimpleNamespace(tool_id=tool_id, revenue=Decimal("9.50"))]),
            Result(
                [
                    SimpleNamespace(
                        id=tool_id,
                        name="Measured Tool",
                        slug="measured-tool",
                        status=ToolStatus.live,
                        uptime_percentage=Decimal("99.25"),
                        created_at=datetime(2026, 6, 1, tzinfo=UTC),
                        requests_this_month=18,
                        unique_users_this_month=6,
                        avg_response_time_ms=87.5,
                        p50_response_time_ms=70,
                        p95_response_time_ms=125,
                        p99_response_time_ms=180,
                    )
                ]
            ),
            Result(
                [
                    SimpleNamespace(
                        id=activity_id,
                        tool_id=tool_id,
                        tool_name="Measured Tool",
                        request_timestamp=datetime(2026, 7, 1, tzinfo=UTC),
                        status_code=200,
                        response_time_ms=76,
                        cost=Decimal("0.02"),
                        error_message=None,
                    )
                ]
            ),
        ]
    )

    async def no_jobs(db, tool_ids):
        return {}

    monkeypatch.setattr(seller_service.job_service, "list_latest_tool_jobs", no_jobs)

    summary = await seller_service.get_seller_dashboard(session, seller_id)

    tool = summary.tools[0]
    assert tool.revenue_this_month == Decimal("9.50")
    assert tool.unique_users_this_month == 6
    assert tool.p50_response_time_ms == 70
    assert tool.p95_response_time_ms == 125
    assert tool.p99_response_time_ms == 180
    assert tool.uptime_percentage == Decimal("99.25")
    assert summary.revenue_chart_data[0].amount == Decimal("9.50")
    assert summary.request_chart_data[0].count == 18
    assert summary.latency_chart_data[0].avg_response_time_ms == 87.5
    assert summary.recent_activity[0].id == activity_id

    statements = "\n".join(str(statement) for statement in session.statements)
    assert "transactions.seller_payout" in statements
    assert "percentile_cont" in statements
