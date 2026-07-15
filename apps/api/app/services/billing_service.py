import asyncio
import hashlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import urlparse

import stripe
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import AsyncSessionLocal, _redis_client
from app.exceptions import AppError, Forbidden, ToolNotFoundError, ToolNotLiveError
from app.models import (
    Tool,
    ToolPurchase,
    Transaction,
    TransactionStatus,
    TransactionType,
    UsageLog,
    User,
)
from app.models.tool import OwnershipType, ToolStatus
from app.models.tool_purchase import PurchaseStatus
from app.schemas.billing import (
    BillingInvoiceSummary,
    PaymentMethodSummary,
    RevenueByToolItem,
    SellerBalanceResponse,
    SellerPayoutHistoryItem,
)
from app.services import alert_service

logger = logging.getLogger(__name__)

PLATFORM_FEE_RATE = Decimal("0.20")
RETRYABLE_STRIPE_ERRORS = (
    stripe.APIConnectionError,
    stripe.APIError,
    stripe.RateLimitError,
)
SCHEDULER_LOCK_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""

stripe.api_key = settings.stripe_secret_key


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _stripe_idempotency_key(action: str, *parts: object) -> str:
    canonical = "|".join(str(part) for part in parts)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"hm:{action}:{digest}"


def _is_trusted_stripe_checkout_url(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == "checkout.stripe.com"


def _is_trusted_stripe_connect_url(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == "connect.stripe.com"


async def _call_stripe(func, *args, **kwargs):
    for attempt in range(3):
        try:
            return await asyncio.to_thread(func, *args, **kwargs)
        except RETRYABLE_STRIPE_ERRORS:
            if attempt == 2:
                raise
            await asyncio.sleep(0.5 * (attempt + 1))


async def create_stripe_customer(db: AsyncSession, user: User) -> str:
    if user.stripe_customer_id:
        return user.stripe_customer_id

    customer = await _call_stripe(
        stripe.Customer.create,
        email=user.email,
        name=user.display_name,
        metadata={"user_id": str(user.id)},
        idempotency_key=_stripe_idempotency_key("customer", user.id),
    )
    user.stripe_customer_id = customer["id"]
    await db.commit()
    return user.stripe_customer_id


async def create_stripe_connect_account(db: AsyncSession, user: User) -> str:
    if not user.stripe_connect_id:
        account = await _call_stripe(
            stripe.Account.create,
            type="express",
            email=user.email,
            metadata={"user_id": str(user.id)},
            capabilities={
                "transfers": {"requested": True},
            },
            idempotency_key=_stripe_idempotency_key("connect-account", user.id),
        )
        user.stripe_connect_id = account["id"]
        await db.commit()

    account_link = await _call_stripe(
        stripe.AccountLink.create,
        account=user.stripe_connect_id,
        refresh_url=f"{settings.app_base_url.rstrip('/')}/dashboard/billing?refresh=1",
        return_url=f"{settings.app_base_url.rstrip('/')}/dashboard/billing?connected=1",
        type="account_onboarding",
        idempotency_key=_stripe_idempotency_key("connect-link", user.id, uuid.uuid4()),
    )
    onboarding_url = account_link.get("url")
    if not _is_trusted_stripe_connect_url(onboarding_url):
        raise AppError(
            status_code=502,
            error_code="stripe_onboarding_unavailable",
            message="Stripe onboarding did not return a trusted onboarding URL. Please retry in a moment.",
        )
    return onboarding_url


async def create_setup_intent(db: AsyncSession, user: User) -> str:
    customer_id = await create_stripe_customer(db, user)
    setup_intent = await _call_stripe(
        stripe.SetupIntent.create,
        customer=customer_id,
        automatic_payment_methods={"enabled": True},
        idempotency_key=_stripe_idempotency_key("setup-intent", user.id, uuid.uuid4()),
    )
    return setup_intent["client_secret"]


async def list_payment_methods(user: User) -> list[PaymentMethodSummary]:
    if not user.stripe_customer_id:
        return []

    methods = await _call_stripe(
        stripe.PaymentMethod.list,
        customer=user.stripe_customer_id,
        type="card",
    )
    items: list[PaymentMethodSummary] = []
    for payment_method in methods["data"]:
        card = payment_method.get("card", {})
        items.append(
            PaymentMethodSummary(
                id=payment_method["id"],
                brand=card.get("brand"),
                last4=card.get("last4"),
                exp_month=card.get("exp_month"),
                exp_year=card.get("exp_year"),
            )
        )
    return items


async def purchase_tool(
    db: AsyncSession,
    buyer: User,
    tool_id: uuid.UUID,
    *,
    _retry_stale_pending: bool = True,
) -> tuple[ToolPurchase, str | None]:
    tool = await db.get(Tool, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.status != ToolStatus.live:
        raise ToolNotLiveError(tool.slug)
    if tool.seller_id == buyer.id:
        raise Forbidden("You cannot purchase your own tool.")

    existing, pending = await _get_existing_purchase_state(db, buyer.id, tool.id)
    if existing:
        return existing, None
    if pending:
        checkout_url = await _get_pending_checkout_url(db, buyer, tool)
        if checkout_url:
            return pending, checkout_url
        if _retry_stale_pending:
            await _terminate_stale_pending_purchase(db, pending, buyer.id, tool.id)
            return await purchase_tool(db, buyer, tool_id, _retry_stale_pending=False)
        raise AppError(
            status_code=502,
            error_code="checkout_unavailable",
            message="The existing checkout session could not be recovered. Please retry in a moment.",
        )

    now = datetime.now(UTC)
    purchase_price = _quantize(tool.one_time_price or Decimal("0.00"))
    requires_checkout = tool.ownership_type == OwnershipType.full_sale and purchase_price > 0
    purchase = ToolPurchase(
        id=uuid.uuid4(),
        tool_id=tool.id,
        buyer_id=buyer.id,
        seller_id=tool.seller_id,
        purchase_price=purchase_price,
        purchase_type=tool.ownership_type,
        status=PurchaseStatus.pending if requires_checkout else PurchaseStatus.active,
        created_at=now,
    )
    db.add(purchase)

    transaction: Transaction | None = None
    if purchase_price > 0:
        platform_fee = _quantize(purchase_price * PLATFORM_FEE_RATE)
        transaction = Transaction(
            id=uuid.uuid4(),
            buyer_id=buyer.id,
            seller_id=tool.seller_id,
            tool_id=tool.id,
            amount=purchase_price,
            platform_fee=platform_fee,
            seller_payout=_quantize(purchase_price - platform_fee),
            stripe_payment_intent_id=None,
            type=TransactionType.full_purchase,
            status=TransactionStatus.pending,
            period_start=now,
            period_end=now,
            created_at=now,
        )
        db.add(transaction)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing, pending = await _get_existing_purchase_state(db, buyer.id, tool.id)
        if existing:
            return existing, None
        if pending:
            checkout_url = await _get_pending_checkout_url(db, buyer, tool)
            if checkout_url:
                return pending, checkout_url
            if _retry_stale_pending:
                await _terminate_stale_pending_purchase(db, pending, buyer.id, tool.id)
                return await purchase_tool(db, buyer, tool_id, _retry_stale_pending=False)
        raise

    checkout_url: str | None = None
    if requires_checkout and transaction is not None:
        try:
            checkout_session = await _create_tool_checkout_session(
                buyer, tool, purchase, transaction
            )
        except Exception as exc:
            await _fail_checkout_creation(db, purchase, transaction)
            raise AppError(
                status_code=502,
                error_code="checkout_unavailable",
                message="Stripe checkout could not be created. Please retry in a moment.",
            ) from exc
        checkout_url = checkout_session.get("url")
        if not _is_trusted_stripe_checkout_url(checkout_url):
            await _fail_checkout_creation(db, purchase, transaction)
            raise AppError(
                status_code=502,
                error_code="checkout_unavailable",
                message="Stripe checkout did not return a trusted checkout URL. Please retry in a moment.",
            )
        # Store the Checkout Session ID while pending so buyers can recover the
        # checkout URL. The completion webhook replaces it with the payment
        # intent ID once Stripe confirms payment.
        transaction.stripe_payment_intent_id = checkout_session.get("id") or checkout_session.get(
            "payment_intent"
        )
        await db.commit()

    await db.refresh(purchase)
    return purchase, checkout_url


async def _get_existing_purchase_state(
    db: AsyncSession,
    buyer_id: uuid.UUID,
    tool_id: uuid.UUID,
) -> tuple[ToolPurchase | None, ToolPurchase | None]:
    existing_result = await db.execute(
        select(ToolPurchase).where(
            ToolPurchase.tool_id == tool_id,
            ToolPurchase.buyer_id == buyer_id,
            ToolPurchase.status == PurchaseStatus.active,
        )
    )
    existing = existing_result.scalar_one_or_none()

    pending_result = await db.execute(
        select(ToolPurchase).where(
            ToolPurchase.tool_id == tool_id,
            ToolPurchase.buyer_id == buyer_id,
            ToolPurchase.status == PurchaseStatus.pending,
        )
    )
    pending = pending_result.scalar_one_or_none()
    return existing, pending


async def _create_tool_checkout_session(
    buyer: User,
    tool: Tool,
    purchase: ToolPurchase,
    transaction: Transaction,
) -> dict:
    customer_id = buyer.stripe_customer_id
    checkout_metadata = {
        "purchase_id": str(purchase.id),
        "transaction_id": str(transaction.id),
        "tool_id": str(tool.id),
        "buyer_id": str(buyer.id),
        "seller_id": str(tool.seller_id),
    }
    checkout_session = await _call_stripe(
        stripe.checkout.Session.create,
        mode="payment",
        customer=customer_id,
        customer_email=None if customer_id else buyer.email,
        success_url=f"{settings.app_base_url.rstrip('/')}/dashboard?purchase=success",
        cancel_url=f"{settings.app_base_url.rstrip('/')}/tools/{tool.slug}?purchase=cancelled",
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": tool.name,
                        "description": tool.tagline,
                    },
                    "unit_amount": int(_quantize(purchase.purchase_price) * 100),
                },
                "quantity": 1,
            }
        ],
        metadata=checkout_metadata,
        payment_intent_data={"metadata": checkout_metadata},
        idempotency_key=_stripe_idempotency_key("tool-checkout", purchase.id),
    )
    if hasattr(checkout_session, "to_dict_recursive"):
        return checkout_session.to_dict_recursive()
    return dict(checkout_session)


async def _get_pending_checkout_url(db: AsyncSession, buyer: User, tool: Tool) -> str | None:
    transaction_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.buyer_id == buyer.id,
            Transaction.tool_id == tool.id,
            Transaction.type == TransactionType.full_purchase,
            Transaction.status == TransactionStatus.pending,
            Transaction.stripe_payment_intent_id.is_not(None),
        )
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    transaction = transaction_result.scalar_one_or_none()
    session_id = transaction.stripe_payment_intent_id if transaction else None
    if not session_id or not session_id.startswith("cs_"):
        return None

    try:
        checkout_session = await _call_stripe(stripe.checkout.Session.retrieve, session_id)
    except stripe.StripeError:
        logger.info("Could not retrieve pending checkout session %s", session_id, exc_info=True)
        return None

    checkout_url = checkout_session.get("url")
    if not _is_trusted_stripe_checkout_url(checkout_url):
        logger.warning("Ignoring untrusted checkout URL for pending session %s", session_id)
        return None
    return checkout_url


async def _terminate_stale_pending_purchase(
    db: AsyncSession,
    purchase: ToolPurchase,
    buyer_id: uuid.UUID,
    tool_id: uuid.UUID,
) -> None:
    purchase.status = PurchaseStatus.terminated
    transaction = await _latest_pending_purchase_transaction(db, buyer_id, tool_id)
    if transaction:
        transaction.status = TransactionStatus.failed
    await db.commit()


async def _fail_checkout_creation(
    db: AsyncSession,
    purchase: ToolPurchase,
    transaction: Transaction,
) -> None:
    purchase.status = PurchaseStatus.terminated
    transaction.status = TransactionStatus.failed
    await db.commit()


async def _latest_pending_purchase_transaction(
    db: AsyncSession,
    buyer_id: uuid.UUID,
    tool_id: uuid.UUID,
) -> Transaction | None:
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.buyer_id == buyer_id,
            Transaction.tool_id == tool_id,
            Transaction.type == TransactionType.full_purchase,
            Transaction.status == TransactionStatus.pending,
        )
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def record_usage(user_id, tool_id, amount) -> None:
    logger.info("Recorded usage for user=%s tool=%s amount=%s", user_id, tool_id, amount)


def _period_bounds(now: datetime, *, days: int) -> tuple[datetime, datetime]:
    period_end = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = period_end - timedelta(days=days)
    return period_start, period_end


def _previous_month_bounds(now: datetime) -> tuple[datetime, datetime]:
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    previous_month_end = current_month_start
    previous_month_start = (current_month_start - timedelta(days=1)).replace(day=1)
    return previous_month_start, previous_month_end


async def _existing_usage_invoice(
    db: AsyncSession,
    user_id,
    period_start: datetime,
    period_end: datetime,
) -> Transaction | None:
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.buyer_id == user_id,
            Transaction.type == TransactionType.usage,
            Transaction.period_start == period_start,
            Transaction.period_end == period_end,
            or_(
                Transaction.stripe_invoice_id.is_not(None),
                Transaction.stripe_payment_intent_id.is_not(None),
            ),
        )
        .order_by(Transaction.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _usage_invoice_reference(transaction: Transaction) -> str | None:
    return transaction.stripe_invoice_id or transaction.stripe_payment_intent_id


async def _settle_usage_invoice(
    invoice_id: str,
    *,
    current_invoice: dict | None = None,
) -> dict:
    invoice = current_invoice or await _call_stripe(stripe.Invoice.retrieve, invoice_id)
    invoice_status = invoice.get("status")

    if invoice_status == "draft":
        invoice = await _call_stripe(
            stripe.Invoice.finalize_invoice,
            invoice_id,
            auto_advance=True,
            idempotency_key=_stripe_idempotency_key("finalize-usage-invoice", invoice_id),
        )
    elif invoice_status == "open" and invoice.get("auto_advance") is not True:
        invoice = await _call_stripe(
            stripe.Invoice.modify,
            invoice_id,
            auto_advance=True,
            idempotency_key=_stripe_idempotency_key("resume-usage-invoice", invoice_id),
        )

    if invoice.get("status") not in {"paid", "void", "uncollectible"}:
        try:
            invoice = await _call_stripe(
                stripe.Invoice.pay,
                invoice_id,
                idempotency_key=_stripe_idempotency_key("pay-usage-invoice", invoice_id),
            )
        except stripe.CardError:
            logger.info("Usage invoice payment was declined for invoice %s", invoice_id)

    return invoice


async def _sync_usage_invoice_transactions(
    db: AsyncSession,
    invoice_id: str,
    invoice: dict,
    *,
    transactions: list[Transaction] | None = None,
) -> None:
    if transactions is None:
        result = await db.execute(
            select(Transaction).where(Transaction.stripe_invoice_id == invoice_id)
        )
        transactions = list(result.scalars())

    payment_intent_id = invoice.get("payment_intent")
    invoice_status = invoice.get("status")
    transaction_status = (
        TransactionStatus.completed
        if invoice_status == "paid"
        else TransactionStatus.failed
        if invoice_status in {"void", "uncollectible"}
        else TransactionStatus.pending
    )
    for transaction in transactions:
        if payment_intent_id:
            transaction.stripe_payment_intent_id = payment_intent_id
        if transaction.status not in {
            TransactionStatus.refund_pending,
            TransactionStatus.refunded,
        }:
            transaction.status = transaction_status
    await db.commit()


async def _existing_seller_payout_id(
    db: AsyncSession,
    seller_id,
    period_end: datetime,
) -> str | None:
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.seller_id == seller_id,
            Transaction.period_end <= period_end,
            Transaction.seller_paid_at.is_not(None),
            Transaction.stripe_transfer_id.is_not(None),
        )
        .order_by(Transaction.seller_paid_at.desc())
        .limit(1)
    )
    existing = result.scalar_one_or_none()
    return existing.stripe_transfer_id if existing else None


async def create_usage_invoice(
    db: AsyncSession, user_id, period_start: datetime, period_end: datetime
) -> str | None:
    existing_invoice = await _existing_usage_invoice(db, user_id, period_start, period_end)
    if existing_invoice:
        existing_invoice_id = _usage_invoice_reference(existing_invoice)
        logger.info(
            "Skipping duplicate usage invoice for user=%s period=%s..%s",
            user_id,
            period_start.isoformat(),
            period_end.isoformat(),
        )
        if existing_invoice.stripe_invoice_id:
            settled_invoice = await _settle_usage_invoice(existing_invoice.stripe_invoice_id)
            await _sync_usage_invoice_transactions(
                db,
                existing_invoice.stripe_invoice_id,
                settled_invoice,
            )
        return existing_invoice_id

    user = await db.get(User, user_id)
    if not user:
        return None

    customer_id = await create_stripe_customer(db, user)

    usage_rows = await db.execute(
        select(
            UsageLog.tool_id,
            Tool.name,
            Tool.seller_id,
            func.coalesce(func.sum(UsageLog.cost), 0).label("amount"),
        )
        .join(Tool, Tool.id == UsageLog.tool_id)
        .where(
            UsageLog.user_id == user_id,
            Tool.seller_id != user_id,
            UsageLog.request_timestamp >= period_start,
            UsageLog.request_timestamp < period_end,
        )
        .group_by(UsageLog.tool_id, Tool.name, Tool.seller_id)
    )
    grouped_amounts: dict[tuple[object, str, object], Decimal] = {}
    for row in usage_rows.all():
        key = (row.tool_id, row.name, row.seller_id)
        grouped_amounts[key] = grouped_amounts.get(key, Decimal("0")) + Decimal(row.amount or 0)

    billable_usage = [
        (tool_id, name, seller_id, _quantize(amount))
        for (tool_id, name, seller_id), amount in grouped_amounts.items()
        if _quantize(amount) > 0
    ]
    if not billable_usage:
        return None

    for tool_id, name, _seller_id, amount in billable_usage:
        await _call_stripe(
            stripe.InvoiceItem.create,
            customer=customer_id,
            currency="usd",
            amount=int(amount * 100),
            description=f"{name} usage",
            metadata={
                "tool_id": str(tool_id),
                "buyer_id": str(user_id),
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
            },
            idempotency_key=_stripe_idempotency_key(
                "usage-invoice-item",
                user_id,
                tool_id,
                period_start.isoformat(),
                period_end.isoformat(),
            ),
        )

    invoice = await _call_stripe(
        stripe.Invoice.create,
        customer=customer_id,
        collection_method="charge_automatically",
        auto_advance=False,
        metadata={
            "buyer_id": str(user_id),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        },
        idempotency_key=_stripe_idempotency_key(
            "usage-invoice", user_id, period_start.isoformat(), period_end.isoformat()
        ),
    )
    invoice_id = invoice["id"]
    transactions: list[Transaction] = []
    for tool_id, _name, seller_id, amount in billable_usage:
        platform_fee = _quantize(amount * PLATFORM_FEE_RATE)
        seller_payout = _quantize(amount - platform_fee)
        transaction = Transaction(
            buyer_id=user_id,
            seller_id=seller_id,
            tool_id=tool_id,
            amount=amount,
            platform_fee=platform_fee,
            seller_payout=seller_payout,
            stripe_payment_intent_id=None,
            stripe_invoice_id=invoice_id,
            type=TransactionType.usage,
            status=TransactionStatus.pending,
            period_start=period_start,
            period_end=period_end,
            created_at=datetime.now(UTC),
        )
        db.add(transaction)
        transactions.append(transaction)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        winner = await _existing_usage_invoice(db, user_id, period_start, period_end)
        if winner is None:
            raise
        if winner.stripe_invoice_id:
            settled_invoice = await _settle_usage_invoice(winner.stripe_invoice_id)
            await _sync_usage_invoice_transactions(db, winner.stripe_invoice_id, settled_invoice)
        return _usage_invoice_reference(winner)

    settled_invoice = await _settle_usage_invoice(invoice_id, current_invoice=invoice)
    await _sync_usage_invoice_transactions(
        db,
        invoice_id,
        settled_invoice,
        transactions=transactions,
    )
    return invoice_id


async def process_seller_payout(
    db: AsyncSession,
    seller_id,
    *,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
) -> str | None:
    user = await db.get(User, seller_id)
    if not user or not user.stripe_connect_id:
        return None

    if period_start is None or period_end is None:
        period_start, period_end = _previous_month_bounds(datetime.now(UTC))

    payable_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.seller_id == seller_id,
            Transaction.buyer_id != seller_id,
            Transaction.status == TransactionStatus.completed,
            Transaction.seller_payout > 0,
            Transaction.seller_paid_at.is_(None),
            Transaction.period_end <= period_end,
        )
        .order_by(Transaction.period_end.asc(), Transaction.id.asc())
        .with_for_update()
    )
    payable_transactions = list(payable_result.scalars())
    if not payable_transactions:
        existing_transfer_id = await _existing_seller_payout_id(db, seller_id, period_end)
        if existing_transfer_id:
            logger.info(
                "Skipping duplicate seller payout for seller=%s period=%s..%s",
                seller_id,
                period_start.isoformat(),
                period_end.isoformat(),
            )
        return existing_transfer_id

    amount = _quantize(
        sum(
            (Decimal(transaction.seller_payout) for transaction in payable_transactions),
            start=Decimal("0"),
        )
    )
    if amount <= 0:
        return None

    transaction_ids = sorted(str(transaction.id) for transaction in payable_transactions)
    transfer_group = _stripe_idempotency_key("seller-payout-group", seller_id, *transaction_ids)
    transfer = await _call_stripe(
        stripe.Transfer.create,
        amount=int(amount * 100),
        currency="usd",
        destination=user.stripe_connect_id,
        transfer_group=transfer_group,
        metadata={
            "seller_id": str(seller_id),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "transaction_count": str(len(payable_transactions)),
        },
        idempotency_key=_stripe_idempotency_key("seller-payout", seller_id, *transaction_ids),
    )

    paid_at = datetime.now(UTC)
    for transaction in payable_transactions:
        transaction.seller_paid_at = paid_at
        transaction.stripe_transfer_id = transfer["id"]
    await db.commit()
    return transfer["id"]


async def list_invoices(user: User) -> list[BillingInvoiceSummary]:
    if not user.stripe_customer_id:
        return []
    invoices = await asyncio.to_thread(
        stripe.Invoice.list, customer=user.stripe_customer_id, limit=25
    )
    return [
        BillingInvoiceSummary(
            id=invoice["id"],
            amount_due=Decimal(invoice.get("amount_due", 0)) / 100,
            amount_paid=Decimal(invoice.get("amount_paid", 0)) / 100,
            status=invoice.get("status"),
            created_at=datetime.fromtimestamp(invoice["created"], tz=UTC)
            if invoice.get("created")
            else None,
            hosted_invoice_url=invoice.get("hosted_invoice_url"),
            invoice_pdf=invoice.get("invoice_pdf"),
        )
        for invoice in invoices["data"]
    ]


async def get_seller_balance(db: AsyncSession, user: User) -> SellerBalanceResponse:
    if not user.stripe_connect_id:
        return SellerBalanceResponse(
            current_balance=Decimal("0.00"),
            pending_payouts=Decimal("0.00"),
            payout_history=[],
            revenue_by_tool=[],
        )

    balance = await asyncio.to_thread(
        stripe.Balance.retrieve, stripe_account=user.stripe_connect_id
    )
    available = sum(item["amount"] for item in balance.get("available", []))
    pending = sum(item["amount"] for item in balance.get("pending", []))

    transfers = await asyncio.to_thread(
        stripe.Transfer.list,
        destination=user.stripe_connect_id,
        limit=25,
    )

    revenue_rows = await db.execute(
        select(
            Tool.id,
            Tool.name,
            func.coalesce(func.sum(Transaction.amount), 0).label("revenue"),
            func.coalesce(func.sum(Transaction.platform_fee), 0).label("platform_fee"),
            func.coalesce(func.sum(Transaction.seller_payout), 0).label("seller_payout"),
        )
        .join(Transaction, Transaction.tool_id == Tool.id)
        .where(
            Tool.seller_id == user.id,
            Transaction.status == TransactionStatus.completed,
        )
        .group_by(Tool.id, Tool.name)
        .order_by(func.coalesce(func.sum(Transaction.amount), 0).desc())
    )

    return SellerBalanceResponse(
        current_balance=Decimal(available) / 100,
        pending_payouts=Decimal(pending) / 100,
        payout_history=[
            SellerPayoutHistoryItem(
                id=item["id"],
                amount=Decimal(item["amount"]) / 100,
                currency=item.get("currency", "usd"),
                created_at=datetime.fromtimestamp(item["created"], tz=UTC)
                if item.get("created")
                else None,
                status="paid",
            )
            for item in transfers["data"]
        ],
        revenue_by_tool=[
            RevenueByToolItem(
                tool_id=str(row.id),
                tool_name=row.name,
                revenue=_quantize(Decimal(row.revenue or 0)),
                platform_fee=_quantize(Decimal(row.platform_fee or 0)),
                seller_payout=_quantize(Decimal(row.seller_payout or 0)),
            )
            for row in revenue_rows.all()
        ],
    )


async def run_daily_aggregation() -> None:
    async with AsyncSessionLocal() as db:
        tool_rows = await db.execute(
            select(
                UsageLog.tool_id,
                func.count(UsageLog.id).label("total_requests"),
                func.avg(UsageLog.response_time_ms).label("avg_response_time_ms"),
            ).group_by(UsageLog.tool_id)
        )
        for row in tool_rows.all():
            tool = await db.get(Tool, row.tool_id)
            if not tool:
                continue
            tool.total_requests = int(row.total_requests or 0)
            tool.avg_response_time_ms = (
                int(row.avg_response_time_ms or 0) if row.avg_response_time_ms else None
            )
        await db.commit()


async def run_weekly_invoicing() -> None:
    async with AsyncSessionLocal() as db:
        period_start, period_end = _period_bounds(datetime.now(UTC), days=7)
        users = await db.execute(
            select(User.id)
            .join(UsageLog, UsageLog.user_id == User.id)
            .where(
                UsageLog.request_timestamp >= period_start, UsageLog.request_timestamp < period_end
            )
            .group_by(User.id)
        )
        failed_users: list[str] = []
        for user_id in [row[0] for row in users.all()]:
            try:
                await create_usage_invoice(db, user_id, period_start, period_end)
            except Exception:
                await db.rollback()
                failed_users.append(str(user_id))
                logger.exception("Weekly invoicing failed for user %s", user_id)
        if failed_users:
            raise RuntimeError(f"Weekly invoicing failed for {len(failed_users)} user(s).")


async def run_monthly_payouts() -> None:
    async with AsyncSessionLocal() as db:
        period_start, period_end = _previous_month_bounds(datetime.now(UTC))
        sellers = await db.execute(select(User).where(User.stripe_connect_id.is_not(None)))
        failed_sellers: list[str] = []
        for seller in sellers.scalars():
            try:
                await process_seller_payout(
                    db,
                    seller.id,
                    period_start=period_start,
                    period_end=period_end,
                )
            except Exception:
                await db.rollback()
                failed_sellers.append(str(seller.id))
                logger.exception("Monthly payout failed for seller %s", seller.id)
        if failed_sellers:
            raise RuntimeError(f"Monthly payouts failed for {len(failed_sellers)} seller(s).")


async def run_scheduler_loop(stop_event: asyncio.Event) -> None:
    if not settings.stripe_secret_key:
        logger.info("Stripe scheduler disabled because STRIPE_SECRET_KEY is not configured.")
        return

    while not stop_event.is_set():
        try:
            await run_scheduled_jobs_once()
        except Exception:
            logger.exception("Billing scheduler loop failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except TimeoutError:
            continue


async def _run_scheduled_task_once(
    completion_key: str,
    *,
    completion_ttl_seconds: int,
    task: Callable[[], Awaitable[None]],
) -> bool:
    if await _redis_client.get(completion_key):
        return False

    lock_key = f"{completion_key}:lock"
    lock_token = uuid.uuid4().hex
    acquired = await _redis_client.set(
        lock_key,
        lock_token,
        ex=settings.worker_job_timeout_seconds,
        nx=True,
    )
    if not acquired:
        return False

    try:
        if await _redis_client.get(completion_key):
            return False
        await task()
        await _redis_client.set(completion_key, "1", ex=completion_ttl_seconds)
        return True
    finally:
        await _redis_client.eval(
            SCHEDULER_LOCK_RELEASE_SCRIPT,
            1,
            lock_key,
            lock_token,
        )


async def run_scheduled_jobs_once() -> None:
    now = datetime.now(UTC)
    day_key = f"billing:last-daily:{now.date().isoformat()}"
    await _run_scheduled_task_once(
        day_key,
        completion_ttl_seconds=60 * 60 * 48,
        task=run_daily_aggregation,
    )

    week_key = f"billing:last-weekly:{now.strftime('%G-W%V')}"
    if now.weekday() == 0:
        await _run_scheduled_task_once(
            week_key,
            completion_ttl_seconds=60 * 60 * 24 * 14,
            task=run_weekly_invoicing,
        )

    month_key = f"billing:last-monthly:{now.strftime('%Y-%m')}"
    if now.day == 1:
        await _run_scheduled_task_once(
            month_key,
            completion_ttl_seconds=60 * 60 * 24 * 40,
            task=run_monthly_payouts,
        )


def verify_webhook(payload: bytes, signature: str):
    return stripe.Webhook.construct_event(
        payload=payload, sig_header=signature, secret=settings.stripe_webhook_secret
    )


async def handle_webhook_event(db: AsyncSession, event: dict) -> None:
    event_type = event.get("type")
    data = event.get("data", {}).get("object", {})

    if event_type == "checkout.session.completed":
        await _complete_checkout_session(db, data)
    elif event_type == "checkout.session.async_payment_succeeded":
        await _complete_checkout_session(db, data, require_paid=False)
    elif event_type == "checkout.session.async_payment_failed":
        await _expire_checkout_session(db, data)
    elif event_type == "checkout.session.expired":
        await _expire_checkout_session(db, data)
    elif event_type == "payment_intent.succeeded":
        await _update_transaction_status(db, {data.get("id")}, TransactionStatus.completed)
    elif event_type == "payment_intent.payment_failed":
        await _update_transaction_status(db, {data.get("id")}, TransactionStatus.failed)
    elif event_type == "invoice.paid":
        await _update_transaction_status(
            db,
            {data.get("payment_intent"), data.get("id")},
            TransactionStatus.completed,
        )
    elif event_type == "invoice.payment_failed":
        await _update_transaction_status(
            db,
            {data.get("payment_intent"), data.get("id")},
            TransactionStatus.failed,
        )
    elif event_type == "charge.refunded":
        await _handle_charge_refunded(db, data)
    elif event_type == "account.updated":
        logger.info("Stripe account updated: %s", data.get("id"))


async def _update_transaction_status(
    db: AsyncSession, provider_references: set[str | None], status: TransactionStatus
) -> None:
    references = {reference for reference in provider_references if reference}
    if not references:
        return
    result = await db.execute(
        select(Transaction).where(
            or_(
                Transaction.stripe_payment_intent_id.in_(references),
                Transaction.stripe_invoice_id.in_(references),
            )
        )
    )
    for transaction in result.scalars():
        if transaction.status in {
            TransactionStatus.refund_pending,
            TransactionStatus.refunded,
        }:
            continue
        transaction.status = status
    await db.commit()


async def _handle_charge_refunded(db: AsyncSession, charge: dict) -> None:
    amount = int(charge.get("amount") or 0)
    amount_refunded = int(charge.get("amount_refunded") or 0)
    is_full_refund = charge.get("refunded") is True or (amount > 0 and amount_refunded >= amount)
    references = {
        reference
        for reference in (
            charge.get("payment_intent"),
            charge.get("invoice"),
        )
        if isinstance(reference, str) and reference
    }
    transactions: list[Transaction] = []
    if references:
        result = await db.execute(
            select(Transaction).where(
                or_(
                    Transaction.stripe_payment_intent_id.in_(references),
                    Transaction.stripe_invoice_id.in_(references),
                )
            )
        )
        transactions.extend(result.scalars())

    transaction_id = _parse_uuid((charge.get("metadata") or {}).get("transaction_id"))
    if transaction_id and not any(transaction.id == transaction_id for transaction in transactions):
        transaction = await db.get(Transaction, transaction_id)
        if transaction is not None:
            transactions.append(transaction)

    if not transactions:
        logger.warning("No local transaction matched refunded Stripe charge %s", charge.get("id"))
        await alert_service.send_alert(
            "stripe_refund_unmatched",
            severity="critical",
            summary="A Stripe refund did not match a local billing transaction.",
            details={
                "charge_id": charge.get("id"),
                "payment_intent_id": charge.get("payment_intent"),
                "invoice_id": charge.get("invoice"),
                "amount": amount,
                "amount_refunded": amount_refunded,
            },
        )
        return

    if not is_full_refund:
        for transaction in transactions:
            if transaction.status != TransactionStatus.refunded:
                transaction.status = TransactionStatus.refund_pending
        await db.commit()
        paid_transfer_ids = sorted(
            {
                transaction.stripe_transfer_id
                for transaction in transactions
                if transaction.stripe_transfer_id
            }
        )
        await alert_service.send_alert(
            "stripe_partial_refund_requires_review",
            severity="critical" if paid_transfer_ids else "warning",
            summary="A partial Stripe refund was held for manual ledger review.",
            details={
                "charge_id": charge.get("id"),
                "payment_intent_id": charge.get("payment_intent"),
                "amount": amount,
                "amount_refunded": amount_refunded,
                "transaction_ids": [str(transaction.id) for transaction in transactions],
                "paid_transfer_ids": paid_transfer_ids,
                "seller_payout_held": not paid_transfer_ids,
            },
        )
        return

    for transaction in transactions:
        transaction.status = TransactionStatus.refunded
        if transaction.type == TransactionType.full_purchase:
            purchase_result = await db.execute(
                select(ToolPurchase).where(
                    ToolPurchase.buyer_id == transaction.buyer_id,
                    ToolPurchase.tool_id == transaction.tool_id,
                    ToolPurchase.status.in_([PurchaseStatus.pending, PurchaseStatus.active]),
                )
            )
            purchase = purchase_result.scalar_one_or_none()
            if purchase is not None:
                purchase.status = PurchaseStatus.terminated
    # Access and ledger state are revoked even if a subsequent Connect reversal
    # needs a worker retry because the seller account has insufficient balance.
    await db.commit()

    reversed_at = datetime.now(UTC)
    for transaction in transactions:
        if (
            not transaction.stripe_transfer_id
            or transaction.stripe_transfer_reversal_id
            or transaction.seller_payout <= 0
        ):
            continue
        reversal = await _call_stripe(
            stripe.Transfer.create_reversal,
            transaction.stripe_transfer_id,
            amount=int(_quantize(Decimal(transaction.seller_payout)) * 100),
            metadata={
                "transaction_id": str(transaction.id),
                "refund_charge_id": str(charge.get("id") or ""),
            },
            idempotency_key=_stripe_idempotency_key("seller-payout-reversal", transaction.id),
        )
        transaction.stripe_transfer_reversal_id = reversal["id"]
        transaction.seller_reversed_at = reversed_at
    await db.commit()


async def _complete_checkout_session(
    db: AsyncSession,
    session: dict,
    *,
    require_paid: bool = True,
) -> None:
    if require_paid and not _checkout_session_is_paid(session):
        logger.info(
            "Deferring checkout completion until payment is confirmed for session %s.",
            session.get("id"),
        )
        return

    metadata = session.get("metadata") or {}
    purchase_id = _parse_uuid(metadata.get("purchase_id"))
    transaction_id = _parse_uuid(metadata.get("transaction_id"))
    payment_id = session.get("payment_intent") or session.get("id")
    purchase, transaction = await _get_checkout_records(db, purchase_id, transaction_id)
    if purchase is None or transaction is None:
        return

    if purchase.status == PurchaseStatus.pending:
        purchase.status = PurchaseStatus.active

    if transaction.status not in {
        TransactionStatus.refund_pending,
        TransactionStatus.refunded,
    }:
        transaction.status = TransactionStatus.completed
    transaction.stripe_payment_intent_id = payment_id

    await db.commit()


def _checkout_session_is_paid(session: dict) -> bool:
    payment_status = session.get("payment_status")
    return payment_status in {"paid", "no_payment_required"}


async def _expire_checkout_session(db: AsyncSession, session: dict) -> None:
    metadata = session.get("metadata") or {}
    purchase_id = _parse_uuid(metadata.get("purchase_id"))
    transaction_id = _parse_uuid(metadata.get("transaction_id"))
    purchase, transaction = await _get_checkout_records(db, purchase_id, transaction_id)
    if purchase is None or transaction is None:
        return

    if purchase.status == PurchaseStatus.pending:
        purchase.status = PurchaseStatus.terminated

    if transaction.status == TransactionStatus.pending:
        transaction.status = TransactionStatus.failed

    await db.commit()


async def _get_checkout_records(
    db: AsyncSession,
    purchase_id: uuid.UUID | None,
    transaction_id: uuid.UUID | None,
) -> tuple[ToolPurchase | None, Transaction | None]:
    if not purchase_id or not transaction_id:
        logger.warning(
            "Ignoring Stripe checkout webhook with missing purchase or transaction metadata."
        )
        return None, None

    purchase = await db.get(ToolPurchase, purchase_id)
    transaction = await db.get(Transaction, transaction_id)
    if not purchase or not transaction:
        logger.warning(
            "Ignoring Stripe checkout webhook for unknown purchase or transaction metadata.",
        )
        return None, None

    if not _checkout_transaction_matches_purchase(transaction, purchase):
        logger.warning(
            "Ignoring Stripe checkout webhook with mismatched purchase and transaction metadata.",
        )
        return None, None

    return purchase, transaction


def _checkout_transaction_matches_purchase(
    transaction: Transaction, purchase: ToolPurchase
) -> bool:
    return (
        transaction.type == TransactionType.full_purchase
        and transaction.buyer_id == purchase.buyer_id
        and transaction.seller_id == purchase.seller_id
        and transaction.tool_id == purchase.tool_id
        and transaction.amount == purchase.purchase_price
    )


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        logger.warning("Ignoring Stripe webhook with invalid UUID metadata: %s", value)
        return None
