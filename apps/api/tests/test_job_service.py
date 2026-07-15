from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models import ToolProcessingJobStatus
from app.services import job_service


class FakeJobSession:
    def __init__(self):
        self.commits = 0
        self.refreshes = 0

    async def commit(self):
        self.commits += 1

    async def refresh(self, job):
        self.refreshes += 1


@pytest.mark.asyncio
async def test_fast_tool_worker_completion_is_not_overwritten(monkeypatch):
    job = SimpleNamespace(
        id="job-id",
        status=ToolProcessingJobStatus.queued,
        enqueued_at=None,
        finished_at=None,
    )
    tool = SimpleNamespace(id="tool-id")
    db = FakeJobSession()

    async def fake_create(*args, **kwargs):
        return job, True

    async def fake_enqueue(job_id):
        assert db.commits == 1
        assert job.enqueued_at is not None
        job.status = ToolProcessingJobStatus.succeeded
        job.finished_at = datetime.now(UTC)
        return "tool-processing:job-id"

    monkeypatch.setattr(job_service, "create_tool_processing_job", fake_create)
    monkeypatch.setattr(job_service.queue_service, "enqueue_tool_processing_job", fake_enqueue)

    result = await job_service.enqueue_tool_processing(db, tool, trigger="upload")

    assert result.status == ToolProcessingJobStatus.succeeded
    assert result.finished_at is not None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_tool_queue_failure_marks_persisted_job_failed(monkeypatch):
    job = SimpleNamespace(
        id="job-id",
        status=ToolProcessingJobStatus.queued,
        enqueued_at=None,
        finished_at=None,
    )
    tool = SimpleNamespace(id="tool-id")
    db = FakeJobSession()
    failures = []

    async def fake_create(*args, **kwargs):
        return job, True

    async def fail_enqueue(job_id):
        raise RuntimeError("redis unavailable")

    async def fake_mark_failed(current_db, current_job, *, error):
        failures.append(error)
        current_job.status = ToolProcessingJobStatus.failed
        return current_job

    monkeypatch.setattr(job_service, "create_tool_processing_job", fake_create)
    monkeypatch.setattr(job_service.queue_service, "enqueue_tool_processing_job", fail_enqueue)
    monkeypatch.setattr(job_service, "mark_job_failed", fake_mark_failed)

    with pytest.raises(RuntimeError, match="redis unavailable"):
        await job_service.enqueue_tool_processing(db, tool, trigger="upload")

    assert job.status == ToolProcessingJobStatus.failed
    assert failures == ["Could not queue this submission: redis unavailable"]
