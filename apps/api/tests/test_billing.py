from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
import uuid

import pytest

from app.exceptions import Forbidden
from app.models import ToolPurchase, Transaction
from app.models.tool import OwnershipType
from app.models.tool_purchase import PurchaseStatus
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


class FakePurchaseSession:
    def __init__(self, tool, existing=None, pending=None, pending_transaction=None, by_id=None):
        self.tool = tool
        self.existing = existing
        self.pending = pending
        self.pending_transaction = pending_transaction
        self.by_id = by_id or {}
        self.added = []
        self.committed = 0
        self.refreshed = []
        self.execute_calls = 0

    async def get(self, model, key):
        if model is ToolPurchase or model is Transaction:
            return self.by_id.get(key)
        return self.tool

    async def execute(self, statement):
        self.execute_calls += 1
        if self.execute_calls == 1:
            return SimpleNamespace(scalar_one_or_none=lambda: self.existing)
        if self.execute_calls == 2:
            return SimpleNamespace(scalar_one_or_none=lambda: self.pending)
        return SimpleNamespace(scalar_one_or_none=lambda: self.pending_transaction)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


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


@pytest.mark.asyncio
async def test_purchase_tool_creates_pending_purchase_and_checkout_session(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    db = FakePurchaseSession(live_tool)

    async def fake_checkout_session(buyer, tool, purchase, transaction):
        return {
            "id": "cs_test_purchase",
            "url": "https://checkout.stripe.test/session",
            "payment_intent": "pi_test_purchase",
        }

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase.status == PurchaseStatus.pending
    assert purchase.purchase_price == Decimal("100.00")
    assert purchase.purchase_type == OwnershipType.full_sale
    assert checkout_url == "https://checkout.stripe.test/session"
    assert db.committed == 1
    assert any(isinstance(item, ToolPurchase) for item in db.added)
    transaction = next(item for item in db.added if isinstance(item, Transaction))
    assert transaction.amount == Decimal("100.00")
    assert transaction.platform_fee == Decimal("20.00")
    assert transaction.seller_payout == Decimal("80.00")
    assert transaction.stripe_payment_intent_id == "pi_test_purchase"


@pytest.mark.asyncio
async def test_purchase_tool_is_idempotent_for_existing_active_purchase(buyer, live_tool):
    existing = ToolPurchase(
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("0.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.active,
        created_at=datetime.now(timezone.utc),
    )
    db = FakePurchaseSession(live_tool, existing=existing)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase is existing
    assert checkout_url is None
    assert db.added == []
    assert db.committed == 0


@pytest.mark.asyncio
async def test_purchase_tool_reuses_pending_checkout_session(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    pending = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("100.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.pending,
        created_at=datetime.now(timezone.utc),
    )
    pending_transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        tool_id=live_tool.id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_existing",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(timezone.utc),
        period_end=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db = FakePurchaseSession(live_tool, pending=pending, pending_transaction=pending_transaction)

    async def fake_call_stripe(func, *args, **kwargs):
        return {"id": "cs_test_existing", "url": "https://checkout.stripe.test/existing"}

    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase is pending
    assert checkout_url == "https://checkout.stripe.test/existing"
    assert db.added == []
    assert db.committed == 0


@pytest.mark.asyncio
async def test_purchase_tool_rejects_seller_buying_own_tool(seller, live_tool):
    db = FakePurchaseSession(live_tool)

    with pytest.raises(Forbidden):
        await billing_service.purchase_tool(db, seller, live_tool.id)


def test_purchase_tool_route_returns_checkout_url(client, auth_overrides, buyer, live_tool, monkeypatch):
    auth_overrides(current_user=buyer)
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(timezone.utc),
    )

    async def fake_purchase_tool(db, current_user, tool_id):
        assert current_user is buyer
        assert tool_id == live_tool.id
        return purchase, "https://checkout.stripe.test/session"

    monkeypatch.setattr(billing_service, "purchase_tool", fake_purchase_tool)

    response = client.post(f"/v1/billing/tools/{live_tool.id}/purchase")

    assert response.status_code == 201
    payload = response.json()
    assert payload["id"] == str(purchase.id)
    assert payload["tool_id"] == str(live_tool.id)
    assert payload["buyer_id"] == str(buyer.id)
    assert payload["seller_id"] == str(live_tool.seller_id)
    assert payload["status"] == "pending"
    assert payload["purchase_price"] == "100.00"
    assert payload["purchase_type"] == "full_sale"
    assert payload["checkout_url"] == "https://checkout.stripe.test/session"


def test_purchase_tool_route_supports_existing_active_purchase(client, auth_overrides, buyer, live_tool, monkeypatch):
    auth_overrides(current_user=buyer)
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("0.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.active,
        created_at=datetime.now(timezone.utc),
    )

    async def fake_purchase_tool(db, current_user, tool_id):
        return purchase, None

    monkeypatch.setattr(billing_service, "purchase_tool", fake_purchase_tool)

    response = client.post(f"/v1/billing/tools/{live_tool.id}/purchase")

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "active"
    assert payload["checkout_url"] is None


def test_stripe_webhook_requires_signature(client):
    response = client.post("/v1/billing/webhook", content=b"{}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_signature"


def test_stripe_webhook_rejects_invalid_signature(client, monkeypatch):
    def fake_verify_webhook(payload, signature):
        raise ValueError("bad signature")

    monkeypatch.setattr(billing_service, "verify_webhook", fake_verify_webhook)

    response = client.post("/v1/billing/webhook", content=b"{}", headers={"Stripe-Signature": "bad"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_signature"


def test_stripe_webhook_dispatches_verified_event(client, monkeypatch):
    handled = []

    def fake_verify_webhook(payload, signature):
        assert payload == b'{"type":"checkout.session.completed"}'
        assert signature == "sig_test"
        return {"type": "checkout.session.completed", "data": {"object": {"id": "cs_test"}}}

    async def fake_handle_webhook_event(db, event):
        handled.append(event)

    monkeypatch.setattr(billing_service, "verify_webhook", fake_verify_webhook)
    monkeypatch.setattr(billing_service, "handle_webhook_event", fake_handle_webhook_event)

    response = client.post(
        "/v1/billing/webhook",
        content=b'{"type":"checkout.session.completed"}',
        headers={"Stripe-Signature": "sig_test"},
    )

    assert response.status_code == 204
    assert handled == [{"type": "checkout.session.completed", "data": {"object": {"id": "cs_test"}}}]


@pytest.mark.asyncio
async def test_checkout_webhook_activates_pending_purchase_and_transaction():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(timezone.utc),
    )
    transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=purchase.buyer_id,
        seller_id=purchase.seller_id,
        tool_id=purchase.tool_id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_purchase",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(timezone.utc),
        period_end=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db = FakePurchaseSession(None, by_id={purchase.id: purchase, transaction.id: transaction})

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "id": "cs_test_purchase",
                    "payment_intent": "pi_test_purchase",
                    "metadata": {
                        "purchase_id": str(purchase.id),
                        "transaction_id": str(transaction.id),
                    },
                }
            },
        },
    )

    assert purchase.status == PurchaseStatus.active
    assert transaction.status == billing_service.TransactionStatus.completed
    assert transaction.stripe_payment_intent_id == "pi_test_purchase"
    assert db.committed == 1


@pytest.mark.asyncio
async def test_expired_checkout_terminates_pending_purchase():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(timezone.utc),
    )
    transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=purchase.buyer_id,
        seller_id=purchase.seller_id,
        tool_id=purchase.tool_id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_purchase",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(timezone.utc),
        period_end=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db = FakePurchaseSession(None, by_id={purchase.id: purchase, transaction.id: transaction})

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.expired",
            "data": {
                "object": {
                    "metadata": {
                        "purchase_id": str(purchase.id),
                        "transaction_id": str(transaction.id),
                    },
                }
            },
        },
    )

    assert purchase.status == PurchaseStatus.terminated
    assert transaction.status == billing_service.TransactionStatus.failed
    assert db.committed == 1
