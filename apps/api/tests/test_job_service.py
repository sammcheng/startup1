from datetime import datetime, timezone

import pytest

from app.services import job_service


class _CountResult:
    def __init__(self, value: int) -> None:
        self.value = value

    def scalar_one(self) -> int:
        return self.value


class _FakeCountSession:
    def __init__(self, counts: list[int]) -> None:
        self.counts = counts
        self.executed = 0

    async def execute(self, statement):
        self.executed += 1
        return _CountResult(self.counts.pop(0))


@pytest.mark.asyncio
async def test_processing_job_health_returns_stuck_and_failed_counts(monkeypatch):
    db = _FakeCountSession([2, 4])
    monkeypatch.setattr(job_service.settings, "alert_processing_job_stale_after_seconds", 1800)
    monkeypatch.setattr(job_service.settings, "alert_failed_processing_jobs_threshold", 3)
    monkeypatch.setattr(job_service.settings, "alert_failed_processing_jobs_window_seconds", 900)

    health = await job_service.processing_job_health(db, now=datetime(2026, 1, 1, tzinfo=timezone.utc))

    assert health == {
        "stuck_active": 2,
        "failed_recent": 4,
        "stale_after_seconds": 1800,
        "failed_threshold": 3,
        "failed_window_seconds": 900,
    }
    assert db.executed == 2
