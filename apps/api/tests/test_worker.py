import uuid
from types import SimpleNamespace

import pytest
from arq import Retry

from app import worker
from app.models import ToolProcessingJobStatus
from app.services.container_service import ProcessUploadResult


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None


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
    monkeypatch.setattr(worker.billing_service, "run_scheduled_jobs_once", fake_run_scheduled_jobs_once)
    monkeypatch.setattr(worker.alert_service, "send_alert", fake_send_alert)

    with pytest.raises(RuntimeError):
        await worker.run_billing_scheduled_jobs({})

    assert alerts[0]["event"] == "billing_scheduler_failed"
