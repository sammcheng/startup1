import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from arq import Retry

from app import worker
from app.models import StripeWebhookEventStatus, ToolProcessingJobStatus
from app.services.container_service import ProcessUploadResult


def usage_payload() -> dict:
    return {
        "api_key_id": str(uuid.uuid4()),
        "tool_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "request_timestamp": datetime.now(UTC).isoformat(),
        "response_time_ms": 125,
        "status_code": 200,
        "input_size_bytes": 12,
        "output_size_bytes": 24,
        "cost": str(Decimal("0.25")),
        "error_message": None,
    }


class FakeSession:
    def __init__(self):
        self.rollbacks = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def rollback(self):
        self.rollbacks += 1


@pytest.mark.asyncio
async def test_worker_marks_retrying_before_retry(monkeypatch):
    job_id = uuid.uuid4()
    tool_id = uuid.uuid4()
    job = SimpleNamespace(
        id=job_id,
        tool_id=tool_id,
        status=ToolProcessingJobStatus.queued,
        max_attempts=3,
    )
    transitions: list[tuple[str, int | str]] = []

    async def fake_get_job(db, parsed_job_id):
        return job

    async def fake_mark_running(db, current_job, *, attempt):
        transitions.append(("running", attempt))
        current_job.status = ToolProcessingJobStatus.running
        return current_job

    async def fake_mark_retrying(db, current_job, *, attempt, error):
        transitions.append(("retrying", attempt))
        current_job.status = ToolProcessingJobStatus.retrying
        return current_job

    async def fake_process_tool_upload(current_tool_id, *, final_attempt):
        assert current_tool_id == tool_id
        assert final_attempt is False
        return ProcessUploadResult(succeeded=False, error_message="Render deploy timed out.")

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.job_service, "get_job", fake_get_job)
    monkeypatch.setattr(worker.job_service, "mark_job_running", fake_mark_running)
    monkeypatch.setattr(worker.job_service, "mark_job_retrying", fake_mark_retrying)
    monkeypatch.setattr(worker.container_service, "process_tool_upload", fake_process_tool_upload)

    with pytest.raises(Retry):
        await worker.process_tool_upload_job({"job_try": 1}, str(job_id))

    assert transitions == [("running", 1), ("retrying", 1)]


@pytest.mark.asyncio
async def test_final_worker_failure_does_not_break_api_health(client, monkeypatch):
    job_id = uuid.uuid4()
    tool_id = uuid.uuid4()
    job = SimpleNamespace(
        id=job_id,
        tool_id=tool_id,
        status=ToolProcessingJobStatus.running,
        max_attempts=1,
    )
    transitions: list[str] = []
    alerts = []

    async def fake_get_job(db, parsed_job_id):
        return job

    async def fake_mark_running(db, current_job, *, attempt):
        transitions.append("running")
        return current_job

    async def fake_mark_failed(db, current_job, *, error):
        transitions.append(f"failed:{error}")
        current_job.status = ToolProcessingJobStatus.failed
        return current_job

    async def fake_process_tool_upload(current_tool_id, *, final_attempt):
        assert current_tool_id == tool_id
        assert final_attempt is True
        return ProcessUploadResult(succeeded=False, error_message="Invalid Dockerfile.")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.job_service, "get_job", fake_get_job)
    monkeypatch.setattr(worker.job_service, "mark_job_running", fake_mark_running)
    monkeypatch.setattr(worker.job_service, "mark_job_failed", fake_mark_failed)
    monkeypatch.setattr(worker.container_service, "process_tool_upload", fake_process_tool_upload)
    monkeypatch.setattr(worker.alert_service, "send_alert", fake_send_alert)

    result = await worker.process_tool_upload_job({"job_try": 1}, str(job_id))

    assert result == {"status": "failed"}
    assert transitions == ["running", "failed:Invalid Dockerfile."]
    assert alerts[0]["event"] == "tool_processing_failed"
    assert client.get("/health").status_code == 200


@pytest.mark.asyncio
async def test_billing_scheduler_alerts_on_failure(monkeypatch):
    alerts = []

    async def fake_run_scheduled_jobs_once():
        raise RuntimeError("stripe outage")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(worker.settings, "stripe_secret_key", "sk_test")
    monkeypatch.setattr(
        worker.billing_service, "run_scheduled_jobs_once", fake_run_scheduled_jobs_once
    )
    monkeypatch.setattr(worker.alert_service, "send_alert", fake_send_alert)

    with pytest.raises(RuntimeError):
        await worker.run_billing_scheduled_jobs({})

    assert alerts[0]["event"] == "billing_scheduler_failed"


@pytest.mark.asyncio
async def test_stripe_webhook_worker_marks_event_succeeded(monkeypatch):
    event = SimpleNamespace(
        id="evt_paid",
        event_type="invoice.paid",
        payload={"id": "evt_paid", "type": "invoice.paid", "data": {"object": {}}},
        status=StripeWebhookEventStatus.queued,
        attempts=0,
        max_attempts=3,
    )
    transitions = []

    async def fake_get_event(db, event_id):
        assert event_id == event.id
        return event

    async def fake_mark_processing(db, current):
        transitions.append("processing")
        current.status = StripeWebhookEventStatus.processing
        current.attempts += 1
        return current

    async def fake_handle(db, payload):
        transitions.append("handled")

    async def fake_mark_succeeded(db, current):
        transitions.append("succeeded")
        current.status = StripeWebhookEventStatus.succeeded
        return current

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.stripe_event_service, "get_event", fake_get_event)
    monkeypatch.setattr(worker.stripe_event_service, "mark_processing", fake_mark_processing)
    monkeypatch.setattr(worker.billing_service, "handle_webhook_event", fake_handle)
    monkeypatch.setattr(worker.stripe_event_service, "mark_succeeded", fake_mark_succeeded)

    result = await worker.process_stripe_webhook_job({"job_try": 1}, event.id)

    assert result == {"status": "succeeded"}
    assert transitions == ["processing", "handled", "succeeded"]


@pytest.mark.asyncio
async def test_stripe_webhook_worker_retries_transient_failure(monkeypatch):
    event = SimpleNamespace(
        id="evt_retry",
        event_type="invoice.paid",
        payload={"id": "evt_retry", "type": "invoice.paid", "data": {"object": {}}},
        status=StripeWebhookEventStatus.queued,
        attempts=0,
        max_attempts=3,
    )
    transitions = []
    session = FakeSession()

    async def fake_get_event(db, event_id):
        return event

    async def fake_mark_processing(db, current):
        current.attempts += 1
        transitions.append("processing")
        return current

    async def fail_handle(db, payload):
        raise RuntimeError("database unavailable")

    async def fake_mark_retrying(db, current, *, error):
        transitions.append(f"retrying:{error}")
        return current

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(worker.stripe_event_service, "get_event", fake_get_event)
    monkeypatch.setattr(worker.stripe_event_service, "mark_processing", fake_mark_processing)
    monkeypatch.setattr(worker.billing_service, "handle_webhook_event", fail_handle)
    monkeypatch.setattr(worker.stripe_event_service, "mark_retrying", fake_mark_retrying)

    with pytest.raises(Retry):
        await worker.process_stripe_webhook_job({"job_try": 1}, event.id)

    assert transitions == ["processing", "retrying:RuntimeError: database unavailable"]
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_stripe_webhook_worker_records_final_failure(monkeypatch):
    event = SimpleNamespace(
        id="evt_failed",
        event_type="invoice.payment_failed",
        payload={
            "id": "evt_failed",
            "type": "invoice.payment_failed",
            "data": {"object": {}},
        },
        status=StripeWebhookEventStatus.retrying,
        attempts=2,
        max_attempts=3,
    )
    alerts = []
    session = FakeSession()

    async def fake_get_event(db, event_id):
        return event

    async def fake_mark_processing(db, current):
        current.attempts += 1
        return current

    async def fail_handle(db, payload):
        raise RuntimeError("still unavailable")

    async def fake_mark_failed(db, current, *, error):
        current.status = StripeWebhookEventStatus.failed
        current.last_error = error
        return current

    async def fake_send_alert(event_name, **kwargs):
        alerts.append({"event": event_name, **kwargs})
        return True

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: session)
    monkeypatch.setattr(worker.stripe_event_service, "get_event", fake_get_event)
    monkeypatch.setattr(worker.stripe_event_service, "mark_processing", fake_mark_processing)
    monkeypatch.setattr(worker.billing_service, "handle_webhook_event", fail_handle)
    monkeypatch.setattr(worker.stripe_event_service, "mark_failed", fake_mark_failed)
    monkeypatch.setattr(worker.alert_service, "send_alert", fake_send_alert)

    result = await worker.process_stripe_webhook_job({"job_try": 3}, event.id)

    assert result == {"status": "failed"}
    assert event.status == StripeWebhookEventStatus.failed
    assert alerts[0]["event"] == "stripe_webhook_processing_failed"
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_usage_log_worker_persists_queued_record(monkeypatch):
    usage_log_id = uuid.uuid4()
    captured = []

    async def fake_persist(db, parsed_log_id, entry):
        captured.append((parsed_log_id, entry))
        return True

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.usage_service, "persist_usage_log", fake_persist)

    result = await worker.process_usage_log_job({"job_try": 1}, str(usage_log_id), usage_payload())

    assert result == {"status": "succeeded"}
    assert captured[0][0] == usage_log_id
    assert captured[0][1].cost == Decimal("0.25")


@pytest.mark.asyncio
async def test_usage_log_worker_retries_database_failure(monkeypatch):
    async def fail_persist(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.usage_service, "persist_usage_log", fail_persist)

    with pytest.raises(Retry):
        await worker.process_usage_log_job({"job_try": 1}, str(uuid.uuid4()), usage_payload())


@pytest.mark.asyncio
async def test_usage_log_worker_alerts_after_final_failure(monkeypatch):
    alerts = []

    async def fail_persist(*args, **kwargs):
        raise RuntimeError("database unavailable")

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(worker.usage_service, "persist_usage_log", fail_persist)
    monkeypatch.setattr(worker.alert_service, "send_alert", fake_send_alert)
    monkeypatch.setattr(worker.settings, "worker_job_max_attempts", 3)

    result = await worker.process_usage_log_job({"job_try": 3}, str(uuid.uuid4()), usage_payload())

    assert result == {"status": "failed"}
    assert alerts[0]["event"] == "usage_log_processing_failed"
    assert alerts[0]["severity"] == "critical"
