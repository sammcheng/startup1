import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models import StripeWebhookEvent, StripeWebhookEventStatus
from app.services import queue_service, stripe_event_service


class FakeEventSession:
    def __init__(self, records=None):
        self.records = records or {}
        self.commits = 0
        self.rollbacks = 0

    async def get(self, model, key):
        assert model is StripeWebhookEvent
        return self.records.get(key)

    def add(self, event):
        self.records[event.id] = event

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, event):
        if event.status is None:
            event.status = StripeWebhookEventStatus.queued
        if event.attempts is None:
            event.attempts = 0


def make_event(*, status=StripeWebhookEventStatus.queued, attempts=0, enqueued_at=None):
    return StripeWebhookEvent(
        id="evt_invoice_paid",
        event_type="invoice.paid",
        payload={
            "id": "evt_invoice_paid",
            "type": "invoice.paid",
            "data": {"object": {"id": "in_paid"}},
        },
        status=status,
        attempts=attempts,
        max_attempts=3,
        enqueued_at=enqueued_at,
    )


@pytest.mark.asyncio
async def test_accept_verified_event_persists_before_queueing(monkeypatch):
    db = FakeEventSession()
    queued = []

    async def fake_enqueue(event_id, *, generation):
        event = db.records[event_id]
        assert db.commits == 2
        queued.append((event_id, generation, event.status))
        return f"stripe-webhook:{event_id}:{generation}"

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fake_enqueue)

    receipt, created = await stripe_event_service.accept_verified_event(
        db,
        {
            "id": "evt_invoice_paid",
            "type": "invoice.paid",
            "data": {"object": {"id": "in_paid"}},
        },
    )

    assert created is True
    assert receipt.status == StripeWebhookEventStatus.queued
    assert receipt.enqueued_at is not None
    assert queued == [("evt_invoice_paid", 0, StripeWebhookEventStatus.queued)]
    assert db.commits == 2


@pytest.mark.asyncio
async def test_fast_worker_completion_is_not_overwritten_after_enqueue(monkeypatch):
    db = FakeEventSession()

    async def fake_enqueue(event_id, *, generation):
        assert generation == 0
        event = db.records[event_id]
        event.status = StripeWebhookEventStatus.succeeded
        event.finished_at = datetime.now(UTC)
        return f"stripe-webhook:{event_id}:{generation}"

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fake_enqueue)

    receipt, _ = await stripe_event_service.accept_verified_event(
        db,
        {
            "id": "evt_invoice_paid",
            "type": "invoice.paid",
            "data": {"object": {"id": "in_paid"}},
        },
    )

    assert receipt.status == StripeWebhookEventStatus.succeeded
    assert receipt.finished_at is not None


@pytest.mark.asyncio
async def test_duplicate_active_event_is_not_enqueued_twice(monkeypatch):
    existing = make_event(enqueued_at=datetime.now(UTC))
    db = FakeEventSession({existing.id: existing})

    async def fail_enqueue(*args, **kwargs):
        raise AssertionError("An active duplicate event must not be queued twice.")

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fail_enqueue)

    receipt, created = await stripe_event_service.accept_verified_event(db, existing.payload)

    assert receipt is existing
    assert created is False
    assert db.commits == 0


@pytest.mark.asyncio
async def test_failed_event_can_be_requeued_with_new_generation(monkeypatch):
    existing = make_event(status=StripeWebhookEventStatus.failed, attempts=3)
    db = FakeEventSession({existing.id: existing})
    queued = []

    async def fake_enqueue(event_id, *, generation):
        queued.append((event_id, generation))
        return "requeued"

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fake_enqueue)

    receipt, created = await stripe_event_service.accept_verified_event(db, existing.payload)

    assert created is False
    assert receipt.status == StripeWebhookEventStatus.queued
    assert queued == [(existing.id, 3)]


@pytest.mark.asyncio
async def test_admin_retry_uses_new_generation_and_preserves_fast_completion(monkeypatch):
    now = datetime.now(UTC)
    existing = make_event(status=StripeWebhookEventStatus.failed, attempts=3)
    existing.created_at = now
    existing.updated_at = now
    db = FakeEventSession({existing.id: existing})

    async def fake_enqueue(event_id, *, generation):
        assert generation == 4
        existing.status = StripeWebhookEventStatus.succeeded
        existing.finished_at = datetime.now(UTC)
        return "requeued"

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fake_enqueue)

    retried = await stripe_event_service.retry_webhook_event(db, existing, now=now)

    assert retried.status == StripeWebhookEventStatus.succeeded
    assert retried.finished_at is not None


@pytest.mark.asyncio
async def test_admin_retry_rejects_fresh_active_event(monkeypatch):
    now = datetime.now(UTC)
    existing = make_event(status=StripeWebhookEventStatus.queued, attempts=0)
    existing.created_at = now
    existing.updated_at = now
    db = FakeEventSession({existing.id: existing})

    async def fail_enqueue(*args, **kwargs):
        raise AssertionError("A fresh active event must not be queued twice.")

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fail_enqueue)

    with pytest.raises(ValueError, match="failed or stale"):
        await stripe_event_service.retry_webhook_event(db, existing, now=now)


@pytest.mark.asyncio
async def test_queue_failure_keeps_receipt_available_for_provider_retry(monkeypatch):
    db = FakeEventSession()

    async def fail_enqueue(*args, **kwargs):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(queue_service, "enqueue_stripe_webhook_job", fail_enqueue)

    with pytest.raises(RuntimeError, match="redis unavailable"):
        await stripe_event_service.accept_verified_event(
            db,
            {
                "id": "evt_invoice_paid",
                "type": "invoice.paid",
                "data": {"object": {"id": "in_paid"}},
            },
        )

    receipt = db.records["evt_invoice_paid"]
    assert receipt.enqueued_at is None
    assert receipt.last_error == "Could not queue Stripe webhook: RuntimeError"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"id": "not-a-stripe-event", "type": "invoice.paid"},
        {"id": "evt_valid", "type": ""},
    ],
)
def test_normalize_event_payload_rejects_missing_provider_identity(payload):
    with pytest.raises(ValueError):
        stripe_event_service.normalize_event_payload(payload)


@pytest.mark.asyncio
async def test_webhook_event_health_counts_stuck_and_failed_events(monkeypatch):
    class CountResult:
        def __init__(self, value):
            self.value = value

        def scalar_one(self):
            return self.value

    class CountSession:
        def __init__(self):
            self.values = iter([2, 1])

        async def execute(self, statement):
            return CountResult(next(self.values))

    monkeypatch.setattr(
        stripe_event_service.settings, "alert_stripe_webhook_stale_after_seconds", 900
    )
    monkeypatch.setattr(stripe_event_service.settings, "alert_failed_stripe_webhooks_threshold", 1)
    monkeypatch.setattr(
        stripe_event_service.settings, "alert_failed_stripe_webhooks_window_seconds", 900
    )

    health = await stripe_event_service.webhook_event_health(
        CountSession(), now=datetime(2026, 7, 14, tzinfo=UTC)
    )

    assert health == {
        "stuck_active": 2,
        "failed_recent": 1,
        "stale_after_seconds": 900,
        "failed_threshold": 1,
        "failed_window_seconds": 900,
    }


@pytest.mark.asyncio
async def test_queue_service_uses_deterministic_event_job_id(monkeypatch):
    calls = []

    class FakePool:
        async def enqueue_job(self, *args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(job_id=kwargs["_job_id"])

    async def fake_get_pool():
        return FakePool()

    monkeypatch.setattr(queue_service, "get_arq_pool", fake_get_pool)

    job_id = await queue_service.enqueue_stripe_webhook_job("evt_invoice_paid", generation=3)

    assert job_id == "stripe-webhook:evt_invoice_paid:3"
    assert calls[0][0] == ("process_stripe_webhook_job", "evt_invoice_paid")
    assert calls[0][1]["_job_id"] == "stripe-webhook:evt_invoice_paid:3"
    assert calls[0][1]["_expires"] == queue_service.settings.stripe_webhook_job_expires_seconds


@pytest.mark.asyncio
async def test_queue_service_uses_deterministic_usage_log_job_id(monkeypatch):
    calls = []
    usage_log_id = uuid.uuid4()

    class FakePool:
        async def enqueue_job(self, *args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(job_id=kwargs["_job_id"])

    async def fake_get_pool():
        return FakePool()

    monkeypatch.setattr(queue_service, "get_arq_pool", fake_get_pool)

    job_id = await queue_service.enqueue_usage_log_job(usage_log_id, {"status_code": 200})

    assert job_id == f"usage-log:{usage_log_id}"
    assert calls[0][0] == (
        "process_usage_log_job",
        str(usage_log_id),
        {"status_code": 200},
    )
    assert calls[0][1]["_job_id"] == f"usage-log:{usage_log_id}"
    assert calls[0][1]["_expires"] == queue_service.settings.usage_log_job_expires_seconds
