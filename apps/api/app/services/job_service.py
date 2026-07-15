from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models import Tool, ToolProcessingJob, ToolProcessingJobStatus, ToolStatus
from app.services import queue_service

ACTIVE_JOB_STATUSES = {
    ToolProcessingJobStatus.queued,
    ToolProcessingJobStatus.running,
    ToolProcessingJobStatus.retrying,
}


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ToolProcessingJob | None:
    result = await db.execute(select(ToolProcessingJob).where(ToolProcessingJob.id == job_id))
    return result.scalar_one_or_none()


async def get_job_with_details(db: AsyncSession, job_id: uuid.UUID) -> ToolProcessingJob | None:
    result = await db.execute(
        select(ToolProcessingJob)
        .where(ToolProcessingJob.id == job_id)
        .options(
            selectinload(ToolProcessingJob.tool),
            selectinload(ToolProcessingJob.seller),
        )
    )
    return result.scalar_one_or_none()


async def list_admin_processing_jobs(
    db: AsyncSession,
    *,
    status_filter: ToolProcessingJobStatus | None,
    tool_id: uuid.UUID | None,
    seller_id: uuid.UUID | None,
    page: int,
    limit: int,
) -> tuple[list[ToolProcessingJob], int]:
    """Return processing jobs for admin operations, newest first."""
    base_query = select(ToolProcessingJob).options(
        selectinload(ToolProcessingJob.tool),
        selectinload(ToolProcessingJob.seller),
    )
    count_query = select(func.count()).select_from(ToolProcessingJob)

    filters = []
    if status_filter is not None:
        filters.append(ToolProcessingJob.status == status_filter)
    if tool_id is not None:
        filters.append(ToolProcessingJob.tool_id == tool_id)
    if seller_id is not None:
        filters.append(ToolProcessingJob.seller_id == seller_id)

    for condition in filters:
        base_query = base_query.where(condition)
        count_query = count_query.where(condition)

    offset = (page - 1) * limit
    items_result = await db.execute(
        base_query.order_by(ToolProcessingJob.created_at.desc()).offset(offset).limit(limit)
    )
    total_result = await db.execute(count_query)
    return list(items_result.scalars()), total_result.scalar_one()


async def get_latest_tool_job(db: AsyncSession, tool_id: uuid.UUID) -> ToolProcessingJob | None:
    result = await db.execute(
        select(ToolProcessingJob)
        .where(ToolProcessingJob.tool_id == tool_id)
        .order_by(ToolProcessingJob.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_latest_tool_jobs(
    db: AsyncSession,
    tool_ids: list[uuid.UUID],
) -> dict[uuid.UUID, ToolProcessingJob]:
    if not tool_ids:
        return {}

    result = await db.execute(
        select(ToolProcessingJob)
        .where(ToolProcessingJob.tool_id.in_(tool_ids))
        .order_by(ToolProcessingJob.tool_id.asc(), ToolProcessingJob.created_at.desc())
    )
    latest: dict[uuid.UUID, ToolProcessingJob] = {}
    for job in result.scalars():
        latest.setdefault(job.tool_id, job)
    return latest


async def processing_job_health(db: AsyncSession, *, now: datetime | None = None) -> dict[str, int]:
    """Summarize processing-job risk for production readiness checks."""
    current_time = now or datetime.now(UTC)
    stale_before = current_time - timedelta(
        seconds=settings.alert_processing_job_stale_after_seconds
    )
    failed_since = current_time - timedelta(
        seconds=settings.alert_failed_processing_jobs_window_seconds
    )

    stuck_result = await db.execute(
        select(func.count())
        .select_from(ToolProcessingJob)
        .where(
            ToolProcessingJob.status.in_(ACTIVE_JOB_STATUSES),
            ToolProcessingJob.created_at <= stale_before,
        )
    )
    failed_result = await db.execute(
        select(func.count())
        .select_from(ToolProcessingJob)
        .where(
            ToolProcessingJob.status == ToolProcessingJobStatus.failed,
            ToolProcessingJob.finished_at >= failed_since,
        )
    )

    return {
        "stuck_active": int(stuck_result.scalar_one()),
        "failed_recent": int(failed_result.scalar_one()),
        "stale_after_seconds": settings.alert_processing_job_stale_after_seconds,
        "failed_threshold": settings.alert_failed_processing_jobs_threshold,
        "failed_window_seconds": settings.alert_failed_processing_jobs_window_seconds,
    }


async def create_tool_processing_job(
    db: AsyncSession,
    tool: Tool,
    *,
    trigger: str,
    payload: dict[str, Any] | None = None,
) -> tuple[ToolProcessingJob, bool]:
    result = await db.execute(
        select(ToolProcessingJob)
        .where(
            ToolProcessingJob.tool_id == tool.id,
            ToolProcessingJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(ToolProcessingJob.created_at.desc())
        .limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing, False

    job_id = uuid.uuid4()
    job = ToolProcessingJob(
        id=job_id,
        tool_id=tool.id,
        seller_id=tool.seller_id,
        arq_job_id=queue_service.tool_processing_arq_job_id(job_id),
        trigger=trigger,
        max_attempts=settings.worker_job_max_attempts,
        payload=payload,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job, True


async def enqueue_tool_processing(
    db: AsyncSession,
    tool: Tool,
    *,
    trigger: str,
    payload: dict[str, Any] | None = None,
) -> ToolProcessingJob:
    job, created = await create_tool_processing_job(db, tool, trigger=trigger, payload=payload)
    if not created:
        return job

    # Commit queue metadata before Redis can hand work to a fast worker.
    job.status = ToolProcessingJobStatus.queued
    job.enqueued_at = datetime.now(UTC)
    job.finished_at = None
    await db.commit()
    await db.refresh(job)

    try:
        await queue_service.enqueue_tool_processing_job(job.id)
    except Exception as exc:
        await db.refresh(job)
        if job.status != ToolProcessingJobStatus.succeeded:
            await mark_job_failed(db, job, error=f"Could not queue this submission: {exc}")
        raise

    return job


async def retry_failed_tool_processing_job(
    db: AsyncSession,
    job: ToolProcessingJob,
    *,
    admin_id: uuid.UUID,
    reason: str,
) -> ToolProcessingJob:
    """Create a fresh queued job for a failed submission retry."""
    if job.status != ToolProcessingJobStatus.failed:
        raise ValueError("Only failed processing jobs can be retried.")

    tool = job.tool
    if tool is None:
        result = await db.execute(select(Tool).where(Tool.id == job.tool_id))
        tool = result.scalar_one_or_none()
    if tool is None:
        raise ValueError("Cannot retry a processing job whose tool no longer exists.")

    tool.status = ToolStatus.processing
    tool.processing_error = None
    retry_job = await enqueue_tool_processing(
        db,
        tool,
        trigger="admin_retry",
        payload={
            "retried_from_job_id": str(job.id),
            "retried_by_admin_id": str(admin_id),
            "reason": reason,
        },
    )
    return retry_job


async def mark_job_running(
    db: AsyncSession, job: ToolProcessingJob, *, attempt: int
) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.running
    job.attempts = attempt
    job.started_at = datetime.now(UTC)
    job.finished_at = None
    await db.commit()
    await db.refresh(job)
    return job


async def mark_job_retrying(
    db: AsyncSession,
    job: ToolProcessingJob,
    *,
    attempt: int,
    error: str,
) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.retrying
    job.attempts = attempt
    job.last_error = error
    job.finished_at = None
    await db.commit()
    await db.refresh(job)
    return job


async def mark_job_succeeded(db: AsyncSession, job: ToolProcessingJob) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.succeeded
    job.last_error = None
    job.finished_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)
    return job


async def mark_job_failed(
    db: AsyncSession, job: ToolProcessingJob, *, error: str
) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.failed
    job.last_error = error
    job.finished_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)
    return job
