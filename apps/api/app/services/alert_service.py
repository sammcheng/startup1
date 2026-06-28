from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.config import settings
from app.request_context import get_request_id

logger = logging.getLogger(__name__)


def _dedupe_key(event: str, dedupe_key: str) -> str:
    normalized_event = re.sub(r"[^a-zA-Z0-9:_-]+", "_", event).strip("_")
    normalized_key = re.sub(r"[^a-zA-Z0-9:_-]+", "_", dedupe_key).strip("_")
    return f"hackmarket:alerts:{normalized_event}:{normalized_key}"


async def send_alert(
    event: str,
    *,
    severity: str = "warning",
    summary: str,
    details: dict[str, Any] | None = None,
) -> bool:
    """Send a best-effort production alert to the configured webhook."""
    if not settings.alert_webhook_url:
        return False

    payload = {
        "service": "hackmarket-api",
        "environment": settings.environment,
        "event": event,
        "severity": severity,
        "summary": summary,
        "request_id": get_request_id(),
        "details": details or {},
    }

    try:
        async with httpx.AsyncClient(timeout=settings.alert_webhook_timeout_seconds) as client:
            response = await client.post(settings.alert_webhook_url, json=payload)
            response.raise_for_status()
    except Exception:
        logger.warning("Failed to send production alert for event=%s", event, exc_info=True)
        return False

    return True


async def send_alert_once(
    redis: Any,
    event: str,
    *,
    dedupe_key: str,
    ttl_seconds: int | None = None,
    severity: str = "warning",
    summary: str,
    details: dict[str, Any] | None = None,
) -> bool:
    """Send one alert per event/key window.

    If Redis cannot reserve the dedupe key, fail open and send the alert. Missing
    an incident is worse than sending an occasional duplicate.
    """
    ttl = max(1, ttl_seconds or settings.alert_dedupe_ttl_seconds)
    key = _dedupe_key(event, dedupe_key)

    try:
        reserved = await redis.set(key, "1", ex=ttl, nx=True)
    except Exception:
        logger.warning("Failed to reserve alert dedupe key for event=%s", event, exc_info=True)
        reserved = True

    if not reserved:
        logger.info("Suppressed duplicate alert for event=%s dedupe_key=%s", event, dedupe_key)
        return False

    return await send_alert(
        event,
        severity=severity,
        summary=summary,
        details={**(details or {}), "dedupe_key": dedupe_key, "dedupe_ttl_seconds": ttl},
    )


def redact(value: str | None, *, keep: int = 8) -> str | None:
    if value is None:
        return None
    if len(value) <= keep:
        return "***"
    return f"{value[:keep]}..."
