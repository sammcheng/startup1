from datetime import datetime, timezone
from decimal import Decimal

from app.schemas.dashboard import (
    DashboardActivityItem,
    DashboardPurchasedTool,
    DashboardStatSummary,
    DashboardSummaryResponse,
)
from app.services import dashboard_service


def test_dashboard_summary_route_returns_real_account_fields(client, auth_overrides, buyer, live_tool, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_summary(db, user):
        return DashboardSummaryResponse(
            display_name=user.display_name,
            role=user.role.value,
            stats=DashboardStatSummary(
                total_api_calls_this_month=7,
                total_spend_this_month=Decimal("1.23"),
                total_earned_this_month=Decimal("0.00"),
                active_tools=0,
            ),
            active_api_keys=2,
            purchased_tools=[
                DashboardPurchasedTool(
                    tool_id=live_tool.id,
                    tool_name=live_tool.name,
                    slug=live_tool.slug,
                    category=live_tool.category.value,
                    calls_this_month=7,
                    spend_this_month=Decimal("1.23"),
                    last_used_at=datetime.now(timezone.utc),
                )
            ],
            recent_activity=[
                DashboardActivityItem(
                    id=live_tool.id,
                    tool_id=live_tool.id,
                    tool_name=live_tool.name,
                    request_timestamp=datetime.now(timezone.utc),
                    status_code=200,
                    response_time_ms=42,
                    cost=Decimal("0.25"),
                    error_message=None,
                )
            ],
        )

    monkeypatch.setattr(dashboard_service, "get_dashboard_summary", fake_summary)

    response = client.get("/v1/dashboard/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_api_keys"] == 2
    assert payload["purchased_tools"][0]["slug"] == live_tool.slug
    assert payload["recent_activity"][0]["tool_name"] == live_tool.name


def test_dashboard_legacy_alias_matches_summary(client, auth_overrides, buyer, monkeypatch):
    auth_overrides(current_user=buyer)
    calls = 0

    async def fake_summary(db, user):
        nonlocal calls
        calls += 1
        return DashboardSummaryResponse(
            display_name=user.display_name,
            role=user.role.value,
            stats=DashboardStatSummary(
                total_api_calls_this_month=0,
                total_spend_this_month=Decimal("0.00"),
                total_earned_this_month=Decimal("0.00"),
                active_tools=0,
            ),
            active_api_keys=0,
            purchased_tools=[],
            recent_activity=[],
        )

    monkeypatch.setattr(dashboard_service, "get_dashboard_summary", fake_summary)

    response = client.get("/v1/dashboard")

    assert response.status_code == 200
    assert response.json()["active_api_keys"] == 0
    assert calls == 1
