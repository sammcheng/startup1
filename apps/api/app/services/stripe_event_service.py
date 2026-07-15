from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import StripeWebhookEvent, StripeWebhookEventStatus
from app.services import queue_service

ACTIVE_EVENT_STATUSES = {
    StripeWebhookEventStatus.queued,
    StripeWebhookEventStatus.processing,
    StripeWebhookEventStatus.retrying,
}


def normalize_event_payload(event: object) -> dict:
    if hasattr(event, "to_dict_recursive"):
        payload = event.to_dict_recursive()
    elif isinstance(event, dict):
        payload = dict(event)
    else:
        raise ValueError("Stripe webhook event must be an object.")

    event_id = payload.get("id")
    event_type = payload.get("type")
    if not isinstance(event_id, str) or not event_id.startswith("evt_") or len(event_id) > 255:
        raise ValueError("Stripe webhook event ID is missing or invalid.")
    if not isinstance(event_type, str) or not event_type or len(event_type) > 100:
        raise ValueError("Stripe webhook event type is missing or invalid.")
    return payload


async def get_event(db: AsyncSession, event_id: str) -> StripeWebhookEvent | None:
    return await db.get(StripeWebhookEvent, event_id)


async def _create_event(db: AsyncSession, payload: dict) -> tuple[StripeWebhookEvent, bool]:
    event_id = payload["id"]
    existing = await get_event(db, event_id)
    if existing is not None:
        return existing, False

    event = StripeWebhookEvent(
        id=event_id,
        event_type=payload["type"],
        payload=payload,
        max_attempts=settings.worker_job_max_attempts,
    )
    db.add(event)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await get_event(db, event_id)
        if existing is None:
            raise
        return existing, False
    await db.refresh(event)
    return event, True


async def accept_verified_event(db: AsyncSession, event: object) -> tuple[StripeWebhookEvent, bool]:
    payload = normalize_event_payload(event)
    receipt, created = await _create_event(db, payload)

    if receipt.status == StripeWebhookEventStatus.succeeded:
        return receipt, False
    if (
        not created
        and receipt.status
        in {
            StripeWebhookEventStatus.queued,
            StripeWebhookEventStatus.processing,
            StripeWebhookEventStatus.retrying,
        }
        and receipt.enqueued_at is not None
    ):
        return receipt, False

    await _enqueue_receipt(db, receipt, generation=receipt.attempts)
    return receipt, created


async def _enqueue_receipt(
    db: AsyncSession,
    receipt: StripeWebhookEvent,
    *,
    generation: int,
    mark_failed_on_queue_error: bool = False,
) -> None:
    # Commit queue state before Redis can hand the job to a fast worker.
    receipt.status = StripeWebhookEventStatus.queued
    receipt.enqueued_at = datetime.now(UTC)
    receipt.finished_at = None
    receipt.last_error = None
    await db.commit()
    await db.refresh(receipt)

    try:
        await queue_service.enqueue_stripe_webhook_job(receipt.id, generation=generation)
    except Exception as exc:
        await db.refresh(receipt)
        if receipt.status != StripeWebhookEventStatus.succeeded:
            receipt.last_error = f"Could not queue Stripe webhook: {type(exc).__name__}"
            receipt.enqueued_at = None
            if mark_failed_on_queue_error:
                receipt.status = StripeWebhookEventStatus.failed
                receipt.finished_at = datetime.now(UTC)
            await db.commit()
        raise


async def list_admin_webhook_events(
    db: AsyncSession,
    *,
    status_filter: StripeWebhookEventStatus | None,
    event_type: str | None,
    page: int,
    limit: int,
) -> tuple[list[StripeWebhookEvent], int]:
    base_query = select(StripeWebhookEvent)
    count_query = select(func.count()).select_from(StripeWebhookEvent)
    filters = []
    if status_filter is not None:
        filters.append(StripeWebhookEvent.status == status_filter)
    if event_type:
        filters.append(StripeWebhookEvent.event_type == event_type)
    for condition in filters:
        base_query = base_query.where(condition)
        count_query = count_query.where(condition)

    offset = (page - 1) * limit
    items_result = await db.execute(
        base_query.order_by(StripeWebhookEvent.created_at.desc()).offset(offset).limit(limit)
    )
    total_result = await db.execute(count_query)
    return list(items_result.scalars()), int(total_result.scalar_one())


def webhook_event_is_retryable(
    event: StripeWebhookEvent,
    *,
    now: datetime | None = None,
) -> bool:
    if event.status == StripeWebhookEventStatus.succeeded:
        return False
    if event.status == StripeWebhookEventStatus.failed:
        return True

    current_time = now or datetime.now(UTC)
    last_activity = event.updated_at or event.started_at or event.enqueued_at or event.created_at
    stale_before = current_time - timedelta(
        seconds=settings.alert_stripe_webhook_stale_after_seconds
    )
    return last_activity <= stale_before


async def retry_webhook_event(
    db: AsyncSession,
    event: StripeWebhookEvent,
    *,
    now: datetime | None = None,
) -> StripeWebhookEvent:
    current_time = now or datetime.now(UTC)
    if event.status == StripeWebhookEventStatus.succeeded:
        raise ValueError("Succeeded Stripe webhook events cannot be retried.")

    if not webhook_event_is_retryable(event, now=current_time):
        raise ValueError("Only failed or stale Stripe webhook events can be retried.")

    await _enqueue_receipt(
        db,
        event,
        generation=max(event.attempts, 0) + 1,
        mark_failed_on_queue_error=True,
    )
    return event


async def mark_processing(db: AsyncSession, event: StripeWebhookEvent) -> StripeWebhookEvent:
    event.status = StripeWebhookEventStatus.processing
    event.attempts += 1
    event.started_at = datetime.now(UTC)
    event.finished_at = None
    await db.commit()
    await db.refresh(event)
    return event


async def mark_retrying(
    db: AsyncSession, event: StripeWebhookEvent, *, error: str
) -> StripeWebhookEvent:
    event.status = StripeWebhookEventStatus.retrying
    event.last_error = error
    event.finished_at = None
    await db.commit()
    await db.refresh(event)
    return event


async def mark_succeeded(db: AsyncSession, event: StripeWebhookEvent) -> StripeWebhookEvent:
    event.status = StripeWebhookEventStatus.succeeded
    event.last_error = None
    event.finished_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(event)
    return event


async def mark_failed(
    db: AsyncSession, event: StripeWebhookEvent, *, error: str
) -> StripeWebhookEvent:
    event.status = StripeWebhookEventStatus.failed
    event.last_error = error
    event.finished_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(event)
    return event


async def webhook_event_health(db: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    current_time = now or datetime.now(UTC)
    stale_before = current_time - timedelta(
        seconds=settings.alert_stripe_webhook_stale_after_seconds
    )
    failed_since = current_time - timedelta(
        seconds=settings.alert_failed_stripe_webhooks_window_seconds
    )

    stale_result = await db.execute(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.status.in_(ACTIVE_EVENT_STATUSES),
            StripeWebhookEvent.updated_at <= stale_before,
        )
    )
    failed_result = await db.execute(
        select(func.count())
        .select_from(StripeWebhookEvent)
        .where(
            StripeWebhookEvent.status == StripeWebhookEventStatus.failed,
            StripeWebhookEvent.finished_at >= failed_since,
        )
    )
    return {
        "stuck_active": int(stale_result.scalar_one()),
        "failed_recent": int(failed_result.scalar_one()),
        "stale_after_seconds": settings.alert_stripe_webhook_stale_after_seconds,
        "failed_threshold": settings.alert_failed_stripe_webhooks_threshold,
        "failed_window_seconds": settings.alert_failed_stripe_webhooks_window_seconds,
    }
