from __future__ import annotations

import logging
import uuid

from arq import Retry, cron

from app.config import settings
from app.dependencies import AsyncSessionLocal, _redis_client, engine
from app.models import ToolProcessingJobStatus
from app.services import alert_service, billing_service, container_service, job_service, queue_service
from app.services.proxy_service import close_http_client

logger = logging.getLogger(__name__)


async def process_tool_upload_job(ctx: dict, job_id: str) -> dict[str, str]:
    attempt = int(ctx.get("job_try") or 1)
    parsed_job_id = uuid.UUID(job_id)

    async with AsyncSessionLocal() as db:
        job = await job_service.get_job(db, parsed_job_id)
        if job is None:
            logger.warning("Skipping missing tool processing job %s", job_id)
            return {"status": "missing"}
        if job.status == ToolProcessingJobStatus.succeeded:
            return {"status": "already_succeeded"}
        job = await job_service.mark_job_running(db, job, attempt=attempt)
        tool_id = job.tool_id
        max_attempts = max(job.max_attempts, 1)

    result = await container_service.process_tool_upload(
        tool_id,
        final_attempt=attempt >= max_attempts,
    )

    async with AsyncSessionLocal() as db:
        job = await job_service.get_job(db, parsed_job_id)
        if job is None:
            logger.warning("Tool processing job %s disappeared after execution.", job_id)
            return {"status": "missing_after_run"}

        if result.succeeded:
            await job_service.mark_job_succeeded(db, job)
            return {"status": "succeeded"}

        error = result.error_message or "Tool processing failed."
        if attempt < max_attempts:
            await job_service.mark_job_retrying(db, job, attempt=attempt, error=error)
            raise Retry(defer=min(300, 15 * attempt))

        await job_service.mark_job_failed(db, job, error=error)
        await alert_service.send_alert(
            "tool_processing_failed",
            severity="critical",
            summary="Tool processing failed after all retry attempts.",
            details={
                "job_id": str(parsed_job_id),
                "tool_id": str(job.tool_id),
                "attempt": attempt,
                "max_attempts": max_attempts,
                "error": error,
            },
        )
        return {"status": "failed"}


async def run_billing_scheduled_jobs(ctx: dict) -> dict[str, str]:  # noqa: ARG001
    if not settings.stripe_secret_key:
        logger.info("Skipping billing scheduled jobs because STRIPE_SECRET_KEY is not configured.")
        return {"status": "skipped"}

    try:
        await billing_service.run_scheduled_jobs_once()
    except Exception as exc:
        await alert_service.send_alert(
            "billing_scheduler_failed",
            severity="critical",
            summary="Billing scheduler job failed.",
            details={"error": type(exc).__name__},
        )
        raise
    return {"status": "succeeded"}


async def worker_startup(ctx: dict) -> None:  # noqa: ARG001
    logger.info("Starting Hackmarket worker (env=%s, queue=%s)", settings.environment, settings.worker_queue_name)


async def worker_shutdown(ctx: dict) -> None:  # noqa: ARG001
    await queue_service.close_arq_pool()
    await close_http_client()
    await _redis_client.aclose()
    await engine.dispose()
    logger.info("Hackmarket worker shutdown complete.")


class WorkerSettings:
    functions = [process_tool_upload_job]
    cron_jobs = [
        cron(
            run_billing_scheduled_jobs,
            minute=0,
            timeout=settings.worker_job_timeout_seconds,
            keep_result=settings.worker_job_keep_result_seconds,
            max_tries=1,
            unique=True,
        )
    ]
    on_startup = worker_startup
    on_shutdown = worker_shutdown
    redis_settings = queue_service.get_arq_redis_settings()
    queue_name = settings.worker_queue_name
    max_jobs = settings.worker_concurrency
    job_timeout = settings.worker_job_timeout_seconds
    keep_result = settings.worker_job_keep_result_seconds
    max_tries = settings.worker_job_max_attempts
    health_check_interval = settings.worker_health_check_interval_seconds
    health_check_key = settings.worker_health_check_key
