from __future__ import annotations

import logging
import uuid
from urllib.parse import unquote, urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from redis.asyncio import Redis

from app.config import settings

logger = logging.getLogger(__name__)

_arq_pool: ArqRedis | None = None


def get_arq_redis_settings(redis_url: str | None = None) -> RedisSettings:
    parsed = urlparse(redis_url or settings.redis_url)
    scheme = parsed.scheme.lower()
    if scheme not in {"redis", "rediss"}:
        raise ValueError("Worker queues require a redis:// or rediss:// REDIS_URL.")

    database = 0
    if parsed.path and parsed.path != "/":
        database = int(parsed.path.strip("/") or "0")

    kwargs = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 6379,
        "database": database,
        "password": unquote(parsed.password) if parsed.password else None,
        "ssl": scheme == "rediss",
        "conn_timeout": 5,
        "conn_retries": 3,
        "max_connections": settings.redis_max_connections,
    }
    if parsed.username:
        kwargs["username"] = unquote(parsed.username)
    return RedisSettings(**kwargs)


async def get_arq_pool() -> ArqRedis:
    global _arq_pool
    if _arq_pool is None:
        _arq_pool = await create_pool(
            get_arq_redis_settings(),
            default_queue_name=settings.worker_queue_name,
        )
    return _arq_pool


async def close_arq_pool() -> None:
    global _arq_pool
    if _arq_pool is not None:
        await _arq_pool.aclose()
        _arq_pool = None


def tool_processing_arq_job_id(job_id: uuid.UUID) -> str:
    return f"tool-processing:{job_id}"


def stripe_webhook_arq_job_id(event_id: str, generation: int) -> str:
    return f"stripe-webhook:{event_id}:{generation}"


def usage_log_arq_job_id(usage_log_id: uuid.UUID) -> str:
    return f"usage-log:{usage_log_id}"


async def enqueue_tool_processing_job(job_id: uuid.UUID) -> str | None:
    pool = await get_arq_pool()
    arq_job_id = tool_processing_arq_job_id(job_id)
    job = await pool.enqueue_job(
        "process_tool_upload_job",
        str(job_id),
        _job_id=arq_job_id,
        _queue_name=settings.worker_queue_name,
        _expires=settings.worker_job_timeout_seconds + 600,
    )
    if job is None:
        logger.info("Tool processing job %s was already queued.", job_id)
        return None
    return job.job_id


async def enqueue_stripe_webhook_job(event_id: str, *, generation: int) -> str | None:
    pool = await get_arq_pool()
    arq_job_id = stripe_webhook_arq_job_id(event_id, generation)
    job = await pool.enqueue_job(
        "process_stripe_webhook_job",
        event_id,
        _job_id=arq_job_id,
        _queue_name=settings.worker_queue_name,
        _expires=settings.stripe_webhook_job_expires_seconds,
    )
    if job is None:
        logger.info("Stripe webhook event %s was already queued.", event_id)
        return None
    return job.job_id


async def enqueue_usage_log_job(usage_log_id: uuid.UUID, payload: dict) -> str | None:
    pool = await get_arq_pool()
    arq_job_id = usage_log_arq_job_id(usage_log_id)
    job = await pool.enqueue_job(
        "process_usage_log_job",
        str(usage_log_id),
        payload,
        _job_id=arq_job_id,
        _queue_name=settings.worker_queue_name,
        _expires=settings.usage_log_job_expires_seconds,
    )
    if job is None:
        logger.info("Usage log %s was already queued.", usage_log_id)
        return None
    return job.job_id


async def queue_depth(redis: Redis) -> int:
    if hasattr(redis, "zcard"):
        return int(await redis.zcard(settings.worker_queue_name))
    return 0
