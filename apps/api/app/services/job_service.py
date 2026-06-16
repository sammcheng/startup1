from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Tool, ToolProcessingJob, ToolProcessingJobStatus
from app.services import queue_service

ACTIVE_JOB_STATUSES = {
    ToolProcessingJobStatus.queued,
    ToolProcessingJobStatus.running,
    ToolProcessingJobStatus.retrying,
}


async def get_job(db: AsyncSession, job_id: uuid.UUID) -> ToolProcessingJob | None:
    result = await db.execute(select(ToolProcessingJob).where(ToolProcessingJob.id == job_id))
    return result.scalar_one_or_none()


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

    try:
        await queue_service.enqueue_tool_processing_job(job.id)
    except Exception as exc:
        await mark_job_failed(db, job, error=f"Could not queue this submission: {exc}")
        raise

    job.status = ToolProcessingJobStatus.queued
    job.enqueued_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return job


async def mark_job_running(db: AsyncSession, job: ToolProcessingJob, *, attempt: int) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.running
    job.attempts = attempt
    job.started_at = datetime.now(timezone.utc)
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
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return job


async def mark_job_failed(db: AsyncSession, job: ToolProcessingJob, *, error: str) -> ToolProcessingJob:
    job.status = ToolProcessingJobStatus.failed
    job.last_error = error
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return job
