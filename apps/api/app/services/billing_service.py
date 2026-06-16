import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

import stripe
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import AsyncSessionLocal, _redis_client
from app.exceptions import Forbidden, ToolNotFoundError, ToolNotLiveError
from app.models import Tool, ToolPurchase, Transaction, TransactionStatus, TransactionType, UsageLog, User
from app.models.tool import OwnershipType, ToolStatus
from app.models.tool_purchase import PurchaseStatus
from app.schemas.billing import (
    BillingInvoiceSummary,
    PaymentMethodSummary,
    RevenueByToolItem,
    SellerBalanceResponse,
    SellerPayoutHistoryItem,
)

logger = logging.getLogger(__name__)

PLATFORM_FEE_RATE = Decimal("0.20")

stripe.api_key = settings.stripe_secret_key


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _call_stripe(func, *args, **kwargs):
    for attempt in range(3):
        try:
            return await asyncio.to_thread(func, *args, **kwargs)
        except stripe.StripeError:
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
        )
        user.stripe_connect_id = account["id"]
        await db.commit()

    account_link = await _call_stripe(
        stripe.AccountLink.create,
        account=user.stripe_connect_id,
        refresh_url=f"{settings.app_base_url.rstrip('/')}/dashboard/billing?refresh=1",
        return_url=f"{settings.app_base_url.rstrip('/')}/dashboard/billing?connected=1",
        type="account_onboarding",
    )
    return account_link["url"]


async def create_setup_intent(db: AsyncSession, user: User) -> str:
    customer_id = await create_stripe_customer(db, user)
    setup_intent = await _call_stripe(
        stripe.SetupIntent.create,
        customer=customer_id,
        automatic_payment_methods={"enabled": True},
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


async def purchase_tool(db: AsyncSession, buyer: User, tool_id: uuid.UUID) -> tuple[ToolPurchase, str | None]:
    tool = await db.get(Tool, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.status != ToolStatus.live:
        raise ToolNotLiveError(tool.slug)
    if tool.seller_id == buyer.id:
        raise Forbidden("You cannot purchase your own tool.")

    existing_result = await db.execute(
        select(ToolPurchase).where(
            ToolPurchase.tool_id == tool.id,
            ToolPurchase.buyer_id == buyer.id,
            ToolPurchase.status == PurchaseStatus.active,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return existing, None

    pending_result = await db.execute(
        select(ToolPurchase).where(
            ToolPurchase.tool_id == tool.id,
            ToolPurchase.buyer_id == buyer.id,
            ToolPurchase.status == PurchaseStatus.pending,
        )
    )
    pending = pending_result.scalar_one_or_none()
    if pending:
        return pending, await _get_pending_checkout_url(db, buyer, tool)

    now = datetime.now(timezone.utc)
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

    checkout_url: str | None = None
    if requires_checkout:
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
        checkout_session = await _create_tool_checkout_session(buyer, tool, purchase, transaction)
        checkout_url = checkout_session.get("url")
        transaction.stripe_payment_intent_id = checkout_session.get("payment_intent") or checkout_session.get("id")
    elif purchase_price > 0:
        platform_fee = _quantize(purchase_price * PLATFORM_FEE_RATE)
        db.add(
            Transaction(
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
        )

    await db.commit()
    await db.refresh(purchase)
    return purchase, checkout_url


async def _create_tool_checkout_session(
    buyer: User,
    tool: Tool,
    purchase: ToolPurchase,
    transaction: Transaction,
) -> dict:
    customer_id = buyer.stripe_customer_id
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
        metadata={
            "purchase_id": str(purchase.id),
            "transaction_id": str(transaction.id),
            "tool_id": str(tool.id),
            "buyer_id": str(buyer.id),
            "seller_id": str(tool.seller_id),
        },
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

    return checkout_session.get("url")


async def record_usage(user_id, tool_id, amount) -> None:
    logger.info("Recorded usage for user=%s tool=%s amount=%s", user_id, tool_id, amount)


async def create_usage_invoice(db: AsyncSession, user_id, period_start: datetime, period_end: datetime) -> str | None:
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
            UsageLog.request_timestamp >= period_start,
            UsageLog.request_timestamp < period_end,
        )
        .group_by(UsageLog.tool_id, Tool.name, Tool.seller_id)
    )
    grouped_usage = usage_rows.all()
    if not grouped_usage:
        return None

    for row in grouped_usage:
        amount = _quantize(Decimal(row.amount or 0))
        await _call_stripe(
            stripe.InvoiceItem.create,
            customer=customer_id,
            currency="usd",
            amount=int(amount * 100),
            description=f"{row.name} usage",
            metadata={
                "tool_id": str(row.tool_id),
                "buyer_id": str(user_id),
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
            },
        )

    invoice = await _call_stripe(
        stripe.Invoice.create,
        customer=customer_id,
        collection_method="charge_automatically",
        auto_advance=True,
        metadata={
            "buyer_id": str(user_id),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        },
    )
    finalized = await _call_stripe(stripe.Invoice.finalize_invoice, invoice["id"])
    try:
        paid_invoice = await _call_stripe(stripe.Invoice.pay, finalized["id"])
    except stripe.StripeError:
        paid_invoice = finalized

    for row in grouped_usage:
        amount = _quantize(Decimal(row.amount or 0))
        platform_fee = _quantize(amount * PLATFORM_FEE_RATE)
        seller_payout = _quantize(amount - platform_fee)
        db.add(
            Transaction(
                buyer_id=user_id,
                seller_id=row.seller_id,
                tool_id=row.tool_id,
                amount=amount,
                platform_fee=platform_fee,
                seller_payout=seller_payout,
                stripe_payment_intent_id=paid_invoice.get("payment_intent") or paid_invoice["id"],
                type=TransactionType.usage,
                status=TransactionStatus.completed if paid_invoice.get("status") == "paid" else TransactionStatus.pending,
                period_start=period_start,
                period_end=period_end,
                created_at=datetime.now(timezone.utc),
            )
        )
    await db.commit()
    return paid_invoice["id"]


async def calculate_seller_payout(db: AsyncSession, tool_id, period_start: datetime, period_end: datetime) -> Decimal:
    result = await db.execute(
        select(func.coalesce(func.sum(UsageLog.cost), 0)).where(
            UsageLog.tool_id == tool_id,
            UsageLog.request_timestamp >= period_start,
            UsageLog.request_timestamp < period_end,
        )
    )
    revenue = Decimal(result.scalar() or 0)
    platform_fee = _quantize(revenue * PLATFORM_FEE_RATE)
    estimated_api_cost = Decimal("0.00")
    return _quantize(revenue - platform_fee - estimated_api_cost)


async def process_seller_payout(db: AsyncSession, seller_id, amount: Decimal) -> str | None:
    user = await db.get(User, seller_id)
    if not user or not user.stripe_connect_id or amount <= 0:
        return None

    transfer = await _call_stripe(
        stripe.Transfer.create,
        amount=int(_quantize(amount) * 100),
        currency="usd",
        destination=user.stripe_connect_id,
        metadata={"seller_id": str(seller_id)},
    )

    fallback_tool = await db.execute(
        select(Tool).where(Tool.seller_id == seller_id).order_by(Tool.created_at.asc()).limit(1)
    )
    tool = fallback_tool.scalar_one_or_none()
    if tool:
        db.add(
            Transaction(
                buyer_id=seller_id,
                seller_id=seller_id,
                tool_id=tool.id,
                amount=_quantize(amount),
                platform_fee=Decimal("0.00"),
                seller_payout=_quantize(amount),
                stripe_payment_intent_id=transfer["id"],
                type=TransactionType.usage,
                status=TransactionStatus.completed,
                period_start=datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0),
                period_end=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()

    return transfer["id"]


async def list_invoices(user: User) -> list[BillingInvoiceSummary]:
    if not user.stripe_customer_id:
        return []
    invoices = await asyncio.to_thread(stripe.Invoice.list, customer=user.stripe_customer_id, limit=25)
    return [
        BillingInvoiceSummary(
            id=invoice["id"],
            amount_due=Decimal(invoice.get("amount_due", 0)) / 100,
            amount_paid=Decimal(invoice.get("amount_paid", 0)) / 100,
            status=invoice.get("status"),
            created_at=datetime.fromtimestamp(invoice["created"], tz=timezone.utc) if invoice.get("created") else None,
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

    balance = await asyncio.to_thread(stripe.Balance.retrieve, stripe_account=user.stripe_connect_id)
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
                created_at=datetime.fromtimestamp(item["created"], tz=timezone.utc) if item.get("created") else None,
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
            )
            .group_by(UsageLog.tool_id)
        )
        for row in tool_rows.all():
            tool = await db.get(Tool, row.tool_id)
            if not tool:
                continue
            tool.total_requests = int(row.total_requests or 0)
            tool.avg_response_time_ms = int(row.avg_response_time_ms or 0) if row.avg_response_time_ms else None
        await db.commit()


async def run_weekly_invoicing() -> None:
    async with AsyncSessionLocal() as db:
        period_end = datetime.now(timezone.utc)
        period_start = period_end - timedelta(days=7)
        users = await db.execute(
            select(User.id)
            .join(UsageLog, UsageLog.user_id == User.id)
            .where(UsageLog.request_timestamp >= period_start, UsageLog.request_timestamp < period_end)
            .group_by(User.id)
        )
        for user_id in [row[0] for row in users.all()]:
            try:
                await create_usage_invoice(db, user_id, period_start, period_end)
            except stripe.StripeError:
                logger.exception("Weekly invoicing failed for user %s", user_id)


async def run_monthly_payouts() -> None:
    async with AsyncSessionLocal() as db:
        period_end = datetime.now(timezone.utc)
        period_start = period_end - timedelta(days=30)
        sellers = await db.execute(select(User).where(User.stripe_connect_id.is_not(None)))
        for seller in sellers.scalars():
            revenue_rows = await db.execute(select(Tool.id).where(Tool.seller_id == seller.id))
            total = Decimal("0.00")
            for row in revenue_rows.all():
                total += await calculate_seller_payout(db, row.id, period_start, period_end)
            try:
                await process_seller_payout(db, seller.id, _quantize(total))
            except stripe.StripeError:
                logger.exception("Monthly payout failed for seller %s", seller.id)


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
        except asyncio.TimeoutError:
            continue


async def run_scheduled_jobs_once() -> None:
    now = datetime.now(timezone.utc)
    day_key = f"billing:last-daily:{now.date().isoformat()}"
    if not await _redis_client.get(day_key):
        await run_daily_aggregation()
        await _redis_client.set(day_key, "1", ex=60 * 60 * 48)

    week_key = f"billing:last-weekly:{now.strftime('%G-W%V')}"
    if now.weekday() == 0 and not await _redis_client.get(week_key):
        await run_weekly_invoicing()
        await _redis_client.set(week_key, "1", ex=60 * 60 * 24 * 14)

    month_key = f"billing:last-monthly:{now.strftime('%Y-%m')}"
    if now.day == 1 and not await _redis_client.get(month_key):
        await run_monthly_payouts()
        await _redis_client.set(month_key, "1", ex=60 * 60 * 24 * 40)


def verify_webhook(payload: bytes, signature: str):
    return stripe.Webhook.construct_event(payload=payload, sig_header=signature, secret=settings.stripe_webhook_secret)


async def handle_webhook_event(db: AsyncSession, event: dict) -> None:
    event_type = event.get("type")
    data = event.get("data", {}).get("object", {})

    if event_type == "checkout.session.completed":
        await _complete_checkout_session(db, data)
    elif event_type == "checkout.session.expired":
        await _expire_checkout_session(db, data)
    elif event_type == "payment_intent.succeeded":
        payment_intent_id = data.get("id")
        await _update_transaction_status(db, payment_intent_id, TransactionStatus.completed)
    elif event_type == "invoice.paid":
        payment_intent_id = data.get("payment_intent") or data.get("id")
        await _update_transaction_status(db, payment_intent_id, TransactionStatus.completed)
    elif event_type == "invoice.payment_failed":
        payment_intent_id = data.get("payment_intent") or data.get("id")
        await _update_transaction_status(db, payment_intent_id, TransactionStatus.failed)
    elif event_type == "account.updated":
        logger.info("Stripe account updated: %s", data.get("id"))


async def _update_transaction_status(db: AsyncSession, payment_intent_id: str | None, status: TransactionStatus) -> None:
    if not payment_intent_id:
        return
    result = await db.execute(select(Transaction).where(Transaction.stripe_payment_intent_id == payment_intent_id))
    for transaction in result.scalars():
        transaction.status = status
    await db.commit()


async def _complete_checkout_session(db: AsyncSession, session: dict) -> None:
    metadata = session.get("metadata") or {}
    purchase_id = _parse_uuid(metadata.get("purchase_id"))
    transaction_id = _parse_uuid(metadata.get("transaction_id"))
    payment_id = session.get("payment_intent") or session.get("id")

    if purchase_id:
        purchase = await db.get(ToolPurchase, purchase_id)
        if purchase and purchase.status == PurchaseStatus.pending:
            purchase.status = PurchaseStatus.active

    if transaction_id:
        transaction = await db.get(Transaction, transaction_id)
        if transaction:
            transaction.status = TransactionStatus.completed
            transaction.stripe_payment_intent_id = payment_id

    await db.commit()


async def _expire_checkout_session(db: AsyncSession, session: dict) -> None:
    metadata = session.get("metadata") or {}
    purchase_id = _parse_uuid(metadata.get("purchase_id"))
    transaction_id = _parse_uuid(metadata.get("transaction_id"))

    if purchase_id:
        purchase = await db.get(ToolPurchase, purchase_id)
        if purchase and purchase.status == PurchaseStatus.pending:
            purchase.status = PurchaseStatus.terminated

    if transaction_id:
        transaction = await db.get(Transaction, transaction_id)
        if transaction and transaction.status == TransactionStatus.pending:
            transaction.status = TransactionStatus.failed

    await db.commit()


def _parse_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        logger.warning("Ignoring Stripe webhook with invalid UUID metadata: %s", value)
        return None
