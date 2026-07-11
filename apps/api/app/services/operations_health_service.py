from __future__ import annotations

from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services import job_service, queue_service


def processing_job_check(processing_jobs: dict[str, int]) -> str:
    risks = []
    if processing_jobs["stuck_active"]:
        risks.append("stuck_active")
    if processing_jobs["failed_recent"] >= processing_jobs["failed_threshold"]:
        risks.append("failed_recent")
    return "ok" if not risks else "degraded_" + "_and_".join(risks)


async def get_operations_health(db: AsyncSession, redis: Redis) -> dict[str, Any]:
    """Return the shared production operations-health summary.

    This powers both `/ready` and the admin dashboard so queue, worker, and
    processing-job status cannot drift between operator surfaces.
    """
    checks: dict[str, str] = {}

    try:
        depth = await queue_service.queue_depth(redis)
        worker_health = await redis.get(settings.worker_health_check_key)
        worker_healthy = bool(worker_health)
        queue = {
            "name": settings.worker_queue_name,
            "depth": depth,
            "depth_threshold": settings.alert_queue_depth_threshold,
            "worker_heartbeat": worker_healthy,
            "worker_health_check_key": settings.worker_health_check_key,
        }
        checks["queue"] = (
            "ok" if depth < settings.alert_queue_depth_threshold else "degraded_high_depth"
        )
        checks["worker"] = "ok" if worker_healthy else "missing_heartbeat"
    except Exception:
        queue = {
            "name": settings.worker_queue_name,
            "depth": None,
            "depth_threshold": settings.alert_queue_depth_threshold,
            "worker_heartbeat": False,
            "worker_health_check_key": settings.worker_health_check_key,
        }
        checks["queue"] = "error"
        checks["worker"] = "unknown"

    processing_jobs = await job_service.processing_job_health(db)
    checks["processing_jobs"] = processing_job_check(processing_jobs)

    return {
        "status": "healthy" if all(value == "ok" for value in checks.values()) else "degraded",
        "checks": checks,
        "queue": queue,
        "processing_jobs": processing_jobs,
    }
