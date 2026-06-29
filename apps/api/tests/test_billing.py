import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

from app.exceptions import Forbidden
from app.models import ToolPurchase, Transaction
from app.models.tool import OwnershipType
from app.models.tool_purchase import PurchaseStatus
from app.services import billing_service


def configure_stripe_webhook_secret(monkeypatch):
    monkeypatch.setattr(billing_service.settings, "stripe_webhook_secret", "whsec_test")


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
    def __init__(self, buyer, tool, usage_rows, *, existing_invoice=None):
        self.buyer = buyer
        self.tool = tool
        self.usage_rows = usage_rows
        self.existing_invoice = existing_invoice
        self.added = []
        self.committed = 0
        self.execute_calls = 0

    async def get(self, model, key):
        return self.buyer

    async def execute(self, statement):
        self.execute_calls += 1
        if self.execute_calls == 1:
            return SimpleNamespace(scalar_one_or_none=lambda: self.existing_invoice)
        if self.execute_calls == 2:
            return FakeRowsResult(self.usage_rows)
        if self.execute_calls == 3:
            return SimpleNamespace(scalar_one_or_none=lambda: self.tool)
        return FakeScalarResult(Decimal("10.00"))

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed += 1


class FakePurchaseSession:
    def __init__(
        self,
        tool,
        existing=None,
        pending=None,
        pending_transaction=None,
        by_id=None,
        *,
        commit_error=None,
        existing_after_rollback=None,
        pending_after_rollback=None,
        tool_after_stale_retry=None,
    ):
        self.tool = tool
        self.existing = existing
        self.pending = pending
        self.pending_transaction = pending_transaction
        self.by_id = by_id or {}
        self.commit_error = commit_error
        self.existing_after_rollback = existing_after_rollback
        self.pending_after_rollback = pending_after_rollback
        self.tool_after_stale_retry = tool_after_stale_retry or tool
        self.added = []
        self.committed = 0
        self.rollbacks = 0
        self.refreshed = []
        self.execute_calls = 0
        self.after_rollback_execute_calls = 0

    async def get(self, model, key):
        if model is ToolPurchase or model is Transaction:
            return self.by_id.get(key)
        if self.tool is None:
            self.tool = self.tool_after_stale_retry
            return self.tool
        return self.tool

    async def execute(self, statement):
        self.execute_calls += 1
        if self.rollbacks:
            self.after_rollback_execute_calls += 1
            if self.after_rollback_execute_calls == 1:
                return SimpleNamespace(scalar_one_or_none=lambda: self.existing_after_rollback)
            if self.after_rollback_execute_calls == 2:
                return SimpleNamespace(scalar_one_or_none=lambda: self.pending_after_rollback)
            return SimpleNamespace(scalar_one_or_none=lambda: self.pending_transaction)
        if self.execute_calls == 1:
            return SimpleNamespace(scalar_one_or_none=lambda: self.existing)
        if self.execute_calls == 2:
            pending = self.pending if self.pending and self.pending.status == PurchaseStatus.pending else None
            return SimpleNamespace(scalar_one_or_none=lambda: pending)
        if self.execute_calls == 5:
            return SimpleNamespace(scalar_one_or_none=lambda: self.existing)
        if self.execute_calls == 6:
            pending = self.pending if self.pending and self.pending.status == PurchaseStatus.pending else None
            return SimpleNamespace(scalar_one_or_none=lambda: pending)
        return SimpleNamespace(scalar_one_or_none=lambda: self.pending_transaction)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        if self.commit_error is not None and self.committed == 0:
            raise self.commit_error
        self.committed += 1

    async def rollback(self):
        self.rollbacks += 1
        self.commit_error = None

    async def refresh(self, obj):
        self.refreshed.append(obj)


class FakePayoutSession:
    def __init__(self, seller, tool, *, existing_payout=None):
        self.seller = seller
        self.tool = tool
        self.existing_payout = existing_payout
        self.added = []
        self.committed = 0
        self.execute_calls = 0

    async def get(self, model, key):
        return self.seller

    async def execute(self, statement):
        self.execute_calls += 1
        if self.execute_calls == 1:
            return SimpleNamespace(scalar_one_or_none=lambda: self.existing_payout)
        return SimpleNamespace(scalar_one_or_none=lambda: self.tool)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed += 1


class FakeConnectSession:
    def __init__(self):
        self.committed = 0

    async def commit(self):
        self.committed += 1


@pytest.mark.asyncio
async def test_create_stripe_connect_account_returns_trusted_onboarding_url(seller, monkeypatch):
    db = FakeConnectSession()
    calls = []

    async def fake_call_stripe(func, *args, **kwargs):
        calls.append({"func": func, "kwargs": kwargs})
        if len(calls) == 1:
            return {"id": "acct_test"}
        return {"url": "https://connect.stripe.com/setup/s/acct_test"}

    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)
    monkeypatch.setattr(billing_service.settings, "app_base_url", "https://hackmarket.io")

    onboarding_url = await billing_service.create_stripe_connect_account(db, seller)

    assert onboarding_url == "https://connect.stripe.com/setup/s/acct_test"
    assert seller.stripe_connect_id == "acct_test"
    assert db.committed == 1
    assert calls[1]["kwargs"]["refresh_url"] == "https://hackmarket.io/dashboard/billing?refresh=1"
    assert calls[1]["kwargs"]["return_url"] == "https://hackmarket.io/dashboard/billing?connected=1"


@pytest.mark.asyncio
async def test_create_stripe_connect_account_rejects_untrusted_onboarding_url(seller, monkeypatch):
    db = FakeConnectSession()

    async def fake_call_stripe(func, *args, **kwargs):
        if not seller.stripe_connect_id:
            return {"id": "acct_test"}
        return {"url": "https://attacker.example/setup/s/acct_test"}

    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    with pytest.raises(billing_service.AppError, match="trusted onboarding URL") as exc_info:
        await billing_service.create_stripe_connect_account(db, seller)

    assert exc_info.value.error_code == "stripe_onboarding_unavailable"
    assert seller.stripe_connect_id == "acct_test"
    assert db.committed == 1


@pytest.mark.asyncio
async def test_usage_calculated_correctly(buyer, live_tool, monkeypatch):
    period_end = datetime.now(UTC)
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
    period_end = datetime.now(UTC)
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
async def test_usage_invoice_is_idempotent_for_existing_period(buyer, live_tool, monkeypatch):
    period_end = datetime(2026, 6, 22, tzinfo=UTC)
    period_start = period_end - timedelta(days=7)
    existing = Transaction(
        id=uuid.uuid4(),
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        tool_id=live_tool.id,
        amount=Decimal("10.00"),
        platform_fee=Decimal("2.00"),
        seller_payout=Decimal("8.00"),
        stripe_payment_intent_id="in_existing",
        type=billing_service.TransactionType.usage,
        status=billing_service.TransactionStatus.completed,
        period_start=period_start,
        period_end=period_end,
        created_at=datetime.now(UTC),
    )
    db = FakeBillingSession(buyer, live_tool, [], existing_invoice=existing)

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("Stripe should not be called for an existing billing period")

    monkeypatch.setattr(billing_service, "_call_stripe", fail_if_called)

    invoice_id = await billing_service.create_usage_invoice(db, buyer.id, period_start, period_end)

    assert invoice_id == "in_existing"
    assert db.added == []
    assert db.committed == 0


@pytest.mark.asyncio
async def test_seller_payout_calculated(monkeypatch):
    class FakeRevenueSession:
        async def execute(self, statement):
            return FakeScalarResult(Decimal("10.00"))

    payout = await billing_service.calculate_seller_payout(
        FakeRevenueSession(),
        tool_id="tool-id",
        period_start=datetime.now(UTC) - timedelta(days=30),
        period_end=datetime.now(UTC),
    )

    assert payout == Decimal("8.00")


@pytest.mark.asyncio
async def test_seller_payout_is_idempotent_for_existing_period(seller, live_tool, monkeypatch):
    seller.stripe_connect_id = "acct_existing"
    period_start = datetime(2026, 5, 1, tzinfo=UTC)
    period_end = datetime(2026, 6, 1, tzinfo=UTC)
    existing = Transaction(
        id=uuid.uuid4(),
        buyer_id=seller.id,
        seller_id=seller.id,
        tool_id=live_tool.id,
        amount=Decimal("25.00"),
        platform_fee=Decimal("0.00"),
        seller_payout=Decimal("25.00"),
        stripe_payment_intent_id="tr_existing",
        type=billing_service.TransactionType.usage,
        status=billing_service.TransactionStatus.completed,
        period_start=period_start,
        period_end=period_end,
        created_at=datetime.now(UTC),
    )
    db = FakePayoutSession(seller, live_tool, existing_payout=existing)

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("Stripe should not be called for an existing payout period")

    monkeypatch.setattr(billing_service, "_call_stripe", fail_if_called)

    transfer_id = await billing_service.process_seller_payout(
        db,
        seller.id,
        Decimal("25.00"),
        period_start=period_start,
        period_end=period_end,
    )

    assert transfer_id == "tr_existing"
    assert db.added == []
    assert db.committed == 0


@pytest.mark.asyncio
async def test_purchase_tool_creates_pending_purchase_and_checkout_session(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    db = FakePurchaseSession(live_tool)

    async def fake_checkout_session(buyer, tool, purchase, transaction):
        return {
            "id": "cs_test_purchase",
            "url": "https://checkout.stripe.com/session",
            "payment_intent": "pi_test_purchase",
        }

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase.status == PurchaseStatus.pending
    assert purchase.purchase_price == Decimal("100.00")
    assert purchase.purchase_type == OwnershipType.full_sale
    assert checkout_url == "https://checkout.stripe.com/session"
    assert db.committed == 2
    assert any(isinstance(item, ToolPurchase) for item in db.added)
    transaction = next(item for item in db.added if isinstance(item, Transaction))
    assert transaction.amount == Decimal("100.00")
    assert transaction.platform_fee == Decimal("20.00")
    assert transaction.seller_payout == Decimal("80.00")
    assert transaction.stripe_payment_intent_id == "cs_test_purchase"


@pytest.mark.asyncio
async def test_purchase_tool_rejects_untrusted_checkout_session_url(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    db = FakePurchaseSession(live_tool)

    async def fake_checkout_session(buyer, tool, purchase, transaction):
        return {
            "id": "cs_test_purchase",
            "url": "https://attacker.example/checkout",
            "payment_intent": "pi_test_purchase",
        }

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    with pytest.raises(billing_service.AppError, match="trusted checkout URL"):
        await billing_service.purchase_tool(db, buyer, live_tool.id)

    purchase = next(item for item in db.added if isinstance(item, ToolPurchase))
    transaction = next(item for item in db.added if isinstance(item, Transaction))
    assert purchase.status == PurchaseStatus.terminated
    assert transaction.status == billing_service.TransactionStatus.failed
    assert db.committed == 2


@pytest.mark.asyncio
async def test_purchase_tool_reuses_winning_pending_purchase_after_db_race(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    winning_pending = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("100.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    pending_transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        tool_id=live_tool.id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_winner",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(
        live_tool,
        commit_error=IntegrityError("insert", {}, Exception("unique violation")),
        pending_after_rollback=winning_pending,
        pending_transaction=pending_transaction,
    )
    stripe_calls = []

    async def fake_checkout_session(*args, **kwargs):
        stripe_calls.append((args, kwargs))
        return {"id": "cs_should_not_be_created"}

    async def fake_call_stripe(func, *args, **kwargs):
        return {"id": "cs_test_winner", "url": "https://checkout.stripe.com/winner"}

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)
    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase is winning_pending
    assert checkout_url == "https://checkout.stripe.com/winner"
    assert stripe_calls == []
    assert db.rollbacks == 1


@pytest.mark.asyncio
async def test_purchase_tool_is_idempotent_for_existing_active_purchase(buyer, live_tool):
    existing = ToolPurchase(
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("0.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.active,
        created_at=datetime.now(UTC),
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
        created_at=datetime.now(UTC),
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
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(live_tool, pending=pending, pending_transaction=pending_transaction)

    async def fake_call_stripe(func, *args, **kwargs):
        return {"id": "cs_test_existing", "url": "https://checkout.stripe.com/existing"}

    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert purchase is pending
    assert checkout_url == "https://checkout.stripe.com/existing"
    assert db.added == []
    assert db.committed == 0


@pytest.mark.asyncio
async def test_purchase_tool_retries_pending_purchase_with_untrusted_checkout_url(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    stale_pending = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("100.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    stale_transaction = Transaction(
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
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(live_tool, pending=stale_pending, pending_transaction=stale_transaction)

    async def fake_call_stripe(func, *args, **kwargs):
        return {"id": "cs_test_existing", "url": "https://attacker.example/checkout"}

    async def fake_checkout_session(buyer, tool, purchase, transaction):
        return {
            "id": "cs_test_retry",
            "url": "https://checkout.stripe.com/retry",
            "payment_intent": "pi_test_retry",
        }

    monkeypatch.setattr(billing_service, "_call_stripe", fake_call_stripe)
    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert stale_pending.status == PurchaseStatus.terminated
    assert stale_transaction.status == billing_service.TransactionStatus.failed
    assert purchase is not stale_pending
    assert checkout_url == "https://checkout.stripe.com/retry"
    assert db.committed == 3


@pytest.mark.asyncio
async def test_purchase_tool_terminates_stale_pending_and_retries_checkout(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    stale_pending = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=live_tool.id,
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        purchase_price=Decimal("100.00"),
        purchase_type=live_tool.ownership_type,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    stale_transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=buyer.id,
        seller_id=live_tool.seller_id,
        tool_id=live_tool.id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id=None,
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(
        None,
        pending=stale_pending,
        pending_transaction=stale_transaction,
        tool_after_stale_retry=live_tool,
    )

    async def fake_checkout_session(buyer, tool, purchase, transaction):
        return {
            "id": "cs_test_retry",
            "url": "https://checkout.stripe.com/retry",
            "payment_intent": "pi_test_retry",
        }

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    purchase, checkout_url = await billing_service.purchase_tool(db, buyer, live_tool.id)

    assert stale_pending.status == PurchaseStatus.terminated
    assert stale_transaction.status == billing_service.TransactionStatus.failed
    assert purchase is not stale_pending
    assert purchase.status == PurchaseStatus.pending
    assert checkout_url == "https://checkout.stripe.com/retry"
    assert db.committed == 3


@pytest.mark.asyncio
async def test_purchase_tool_fails_pending_purchase_when_checkout_creation_fails(buyer, live_tool, monkeypatch):
    live_tool.ownership_type = OwnershipType.full_sale
    live_tool.one_time_price = Decimal("100.00")
    db = FakePurchaseSession(live_tool)

    async def fake_checkout_session(*args, **kwargs):
        raise RuntimeError("stripe outage")

    monkeypatch.setattr(billing_service, "_create_tool_checkout_session", fake_checkout_session)

    with pytest.raises(billing_service.AppError, match="Stripe checkout could not be created"):
        await billing_service.purchase_tool(db, buyer, live_tool.id)

    purchase = next(item for item in db.added if isinstance(item, ToolPurchase))
    transaction = next(item for item in db.added if isinstance(item, Transaction))
    assert purchase.status == PurchaseStatus.terminated
    assert transaction.status == billing_service.TransactionStatus.failed
    assert db.committed == 2


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
        created_at=datetime.now(UTC),
    )

    async def fake_purchase_tool(db, current_user, tool_id):
        assert current_user is buyer
        assert tool_id == live_tool.id
        return purchase, "https://checkout.stripe.com/session"

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
    assert payload["checkout_url"] == "https://checkout.stripe.com/session"


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
        created_at=datetime.now(UTC),
    )

    async def fake_purchase_tool(db, current_user, tool_id):
        return purchase, None

    monkeypatch.setattr(billing_service, "purchase_tool", fake_purchase_tool)

    response = client.post(f"/v1/billing/tools/{live_tool.id}/purchase")

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "active"
    assert payload["checkout_url"] is None


def test_stripe_webhook_requires_signature(client, monkeypatch):
    configure_stripe_webhook_secret(monkeypatch)

    response = client.post("/v1/billing/webhook", content=b"{}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "missing_signature"


def test_stripe_webhook_requires_configured_secret(client, monkeypatch):
    alerts = []

    def fail_verify_webhook(*args, **kwargs):
        raise AssertionError("misconfigured webhook must not attempt signature verification")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(billing_service.settings, "stripe_webhook_secret", "")
    monkeypatch.setattr(billing_service, "verify_webhook", fail_verify_webhook)
    monkeypatch.setattr("app.routers.billing.alert_service.send_alert", fake_send_alert)

    response = client.post("/v1/billing/webhook", content=b"{}", headers={"Stripe-Signature": "sig_test"})

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "misconfiguration"
    assert alerts[0]["event"] == "stripe_webhook_misconfigured"


def test_stripe_webhook_rejects_invalid_signature(client, monkeypatch):
    alerts = []

    def fake_verify_webhook(payload, signature):
        raise ValueError("bad signature")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    configure_stripe_webhook_secret(monkeypatch)
    monkeypatch.setattr(billing_service, "verify_webhook", fake_verify_webhook)
    monkeypatch.setattr("app.routers.billing.alert_service.send_alert", fake_send_alert)

    response = client.post("/v1/billing/webhook", content=b"{}", headers={"Stripe-Signature": "bad"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_signature"
    assert alerts[0]["event"] == "stripe_webhook_invalid_signature"


def test_stripe_webhook_dispatches_verified_event(client, monkeypatch):
    handled = []

    def fake_verify_webhook(payload, signature):
        assert payload == b'{"type":"checkout.session.completed"}'
        assert signature == "sig_test"
        return {"type": "checkout.session.completed", "data": {"object": {"id": "cs_test"}}}

    async def fake_handle_webhook_event(db, event):
        handled.append(event)

    configure_stripe_webhook_secret(monkeypatch)
    monkeypatch.setattr(billing_service, "verify_webhook", fake_verify_webhook)
    monkeypatch.setattr(billing_service, "handle_webhook_event", fake_handle_webhook_event)

    response = client.post(
        "/v1/billing/webhook",
        content=b'{"type":"checkout.session.completed"}',
        headers={"Stripe-Signature": "sig_test"},
    )

    assert response.status_code == 204
    assert handled == [{"type": "checkout.session.completed", "data": {"object": {"id": "cs_test"}}}]


def test_stripe_webhook_alerts_when_handler_fails(client, monkeypatch):
    alerts = []

    def fake_verify_webhook(payload, signature):
        return {"type": "invoice.payment_failed", "data": {"object": {"id": "in_test"}}}

    async def fake_handle_webhook_event(db, event):
        raise RuntimeError("database down")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    configure_stripe_webhook_secret(monkeypatch)
    monkeypatch.setattr(billing_service, "verify_webhook", fake_verify_webhook)
    monkeypatch.setattr(billing_service, "handle_webhook_event", fake_handle_webhook_event)
    monkeypatch.setattr("app.routers.billing.alert_service.send_alert", fake_send_alert)

    with pytest.raises(RuntimeError, match="database down"):
        client.post(
            "/v1/billing/webhook",
            content=b'{"type":"invoice.payment_failed"}',
            headers={"Stripe-Signature": "sig_test"},
        )

    assert alerts[0]["event"] == "stripe_webhook_handler_failed"


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
        created_at=datetime.now(UTC),
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
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
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
                    "payment_status": "paid",
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
async def test_checkout_webhook_rejects_mismatched_purchase_transaction_metadata():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=purchase.seller_id,
        tool_id=purchase.tool_id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_purchase",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
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
                    "payment_status": "paid",
                    "metadata": {
                        "purchase_id": str(purchase.id),
                        "transaction_id": str(transaction.id),
                    },
                }
            },
        },
    )

    assert purchase.status == PurchaseStatus.pending
    assert transaction.status == billing_service.TransactionStatus.pending
    assert transaction.stripe_payment_intent_id == "cs_test_purchase"
    assert db.committed == 0


@pytest.mark.asyncio
async def test_expired_checkout_rejects_missing_transaction_metadata():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(None, by_id={purchase.id: purchase})

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.expired",
            "data": {
                "object": {
                    "metadata": {
                        "purchase_id": str(purchase.id),
                    },
                }
            },
        },
    )

    assert purchase.status == PurchaseStatus.pending
    assert db.committed == 0


@pytest.mark.asyncio
async def test_checkout_webhook_defers_unpaid_session_until_async_success():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=purchase.buyer_id,
        seller_id=purchase.seller_id,
        tool_id=purchase.tool_id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_async",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(None, by_id={purchase.id: purchase, transaction.id: transaction})

    event_payload = {
        "data": {
            "object": {
                "id": "cs_test_async",
                "payment_intent": "pi_test_async",
                "metadata": {
                    "purchase_id": str(purchase.id),
                    "transaction_id": str(transaction.id),
                },
            }
        },
    }

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.completed",
            "data": {"object": {**event_payload["data"]["object"], "payment_status": "unpaid"}},
        },
    )

    assert purchase.status == PurchaseStatus.pending
    assert transaction.status == billing_service.TransactionStatus.pending
    assert transaction.stripe_payment_intent_id == "cs_test_async"
    assert db.committed == 0

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.async_payment_succeeded",
            **event_payload,
        },
    )

    assert purchase.status == PurchaseStatus.active
    assert transaction.status == billing_service.TransactionStatus.completed
    assert transaction.stripe_payment_intent_id == "pi_test_async"
    assert db.committed == 1


@pytest.mark.asyncio
async def test_checkout_async_payment_failed_terminates_pending_purchase():
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        buyer_id=uuid.uuid4(),
        seller_id=uuid.uuid4(),
        purchase_price=Decimal("100.00"),
        purchase_type=OwnershipType.full_sale,
        status=PurchaseStatus.pending,
        created_at=datetime.now(UTC),
    )
    transaction = Transaction(
        id=uuid.uuid4(),
        buyer_id=purchase.buyer_id,
        seller_id=purchase.seller_id,
        tool_id=purchase.tool_id,
        amount=Decimal("100.00"),
        platform_fee=Decimal("20.00"),
        seller_payout=Decimal("80.00"),
        stripe_payment_intent_id="cs_test_async",
        type=billing_service.TransactionType.full_purchase,
        status=billing_service.TransactionStatus.pending,
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db = FakePurchaseSession(None, by_id={purchase.id: purchase, transaction.id: transaction})

    await billing_service.handle_webhook_event(
        db,
        {
            "type": "checkout.session.async_payment_failed",
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
        created_at=datetime.now(UTC),
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
        period_start=datetime.now(UTC),
        period_end=datetime.now(UTC),
        created_at=datetime.now(UTC),
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
