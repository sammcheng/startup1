from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models import Transaction
from app.services import billing_service


class FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class FakeRowsResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeBillingSession:
    def __init__(self, buyer, tool, usage_rows):
        self.buyer = buyer
        self.tool = tool
        self.usage_rows = usage_rows
        self.added = []
        self.committed = 0
        self.execute_calls = 0

    async def get(self, model, key):
        return self.buyer

    async def execute(self, statement):
        self.execute_calls += 1
        if self.execute_calls == 1:
            return FakeRowsResult(self.usage_rows)
        if self.execute_calls == 2:
            return SimpleNamespace(scalar_one_or_none=lambda: self.tool)
        return FakeScalarResult(Decimal("10.00"))

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed += 1


@pytest.mark.asyncio
async def test_usage_calculated_correctly(buyer, live_tool, monkeypatch):
    period_end = datetime.now(timezone.utc)
    period_start = period_end - timedelta(days=7)
    usage_rows = [
        SimpleNamespace(tool_id=live_tool.id, name=live_tool.name, seller_id=live_tool.seller_id, amount=Decimal("1.25")),
        SimpleNamespace(tool_id=live_tool.id, name=live_tool.name, seller_id=live_tool.seller_id, amount=Decimal("2.75")),
    ]
    db = FakeBillingSession(buyer, live_tool, usage_rows)

    async def fake_create_customer(db, user):
        return "cus_test"

    async def fake_call_stripe(func, *args, **kwargs):
        func_name = getattr(func, "__name__", "")
        if func_name == "create":
            return {"id": "inv_test", "payment_intent": "pi_test", "status": "paid"}
        return {"id": "inv_test", "payment_intent": "pi_test", "status": "paid"}

    monkeypatch.setattr(billing_service, "create_stripe_customer", fake_create_customer)
    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    invoice_id = await billing_service.create_usage_invoice(db, buyer.id, period_start, period_end)

    assert invoice_id == "inv_test"
    assert sum(tx.amount for tx in db.added if isinstance(tx, Transaction)) == Decimal("4.00")


@pytest.mark.asyncio
async def test_platform_fee_calculated(buyer, live_tool, monkeypatch):
    period_end = datetime.now(timezone.utc)
    period_start = period_end - timedelta(days=7)
    usage_rows = [
        SimpleNamespace(tool_id=live_tool.id, name=live_tool.name, seller_id=live_tool.seller_id, amount=Decimal("10.00")),
    ]
    db = FakeBillingSession(buyer, live_tool, usage_rows)

    async def fake_create_customer(db, user):
        return "cus_test"

    async def fake_call_stripe(func, *args, **kwargs):
        return {"id": "inv_test", "payment_intent": "pi_test", "status": "paid"}

    monkeypatch.setattr(billing_service, "create_stripe_customer", fake_create_customer)
    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    await billing_service.create_usage_invoice(db, buyer.id, period_start, period_end)

    transaction = next(tx for tx in db.added if isinstance(tx, Transaction))
    assert transaction.platform_fee == Decimal("2.00")


@pytest.mark.asyncio
async def test_seller_payout_calculated(monkeypatch):
    class FakeRevenueSession:
        async def execute(self, statement):
            return FakeScalarResult(Decimal("10.00"))

    payout = await billing_service.calculate_seller_payout(
        FakeRevenueSession(),
        tool_id="tool-id",
        period_start=datetime.now(timezone.utc) - timedelta(days=30),
        period_end=datetime.now(timezone.utc),
    )

    assert payout == Decimal("8.00")
