import pytest

from app.services import operations_health_service


class _FakeRedis:
    def __init__(self, heartbeat: str | None = "1") -> None:
        self.heartbeat = heartbeat

    async def get(self, key: str):
        return self.heartbeat


@pytest.mark.asyncio
async def test_operations_health_reports_healthy_when_queue_worker_and_jobs_are_ok(monkeypatch):
    async def fake_queue_depth(redis):
        return 2

    async def fake_processing_job_health(db):
        return {
            "stuck_active": 0,
            "failed_recent": 0,
            "stale_after_seconds": 1800,
            "failed_threshold": 3,
            "failed_window_seconds": 900,
        }

    monkeypatch.setattr(operations_health_service.queue_service, "queue_depth", fake_queue_depth)
    monkeypatch.setattr(
        operations_health_service.job_service, "processing_job_health", fake_processing_job_health
    )
    monkeypatch.setattr(operations_health_service.settings, "alert_queue_depth_threshold", 100)

    health = await operations_health_service.get_operations_health(db=object(), redis=_FakeRedis())

    assert health["status"] == "healthy"
    assert health["checks"] == {"queue": "ok", "worker": "ok", "processing_jobs": "ok"}
    assert health["queue"]["depth"] == 2


@pytest.mark.asyncio
async def test_operations_health_reports_degraded_when_queue_worker_and_jobs_are_risky(monkeypatch):
    async def fake_queue_depth(redis):
        return 120

    async def fake_processing_job_health(db):
        return {
            "stuck_active": 1,
            "failed_recent": 4,
            "stale_after_seconds": 1800,
            "failed_threshold": 3,
            "failed_window_seconds": 900,
        }

    monkeypatch.setattr(operations_health_service.queue_service, "queue_depth", fake_queue_depth)
    monkeypatch.setattr(
        operations_health_service.job_service, "processing_job_health", fake_processing_job_health
    )
    monkeypatch.setattr(operations_health_service.settings, "alert_queue_depth_threshold", 100)

    health = await operations_health_service.get_operations_health(
        db=object(), redis=_FakeRedis(heartbeat=None)
    )

    assert health["status"] == "degraded"
    assert health["checks"] == {
        "queue": "degraded_high_depth",
        "worker": "missing_heartbeat",
        "processing_jobs": "degraded_stuck_active_and_failed_recent",
    }
    assert health["queue"]["worker_heartbeat"] is False
