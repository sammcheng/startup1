from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings
from app.request_context import get_request_id

logger = logging.getLogger(__name__)


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


def redact(value: str | None, *, keep: int = 8) -> str | None:
    if value is None:
        return None
    if len(value) <= keep:
        return "***"
    return f"{value[:keep]}..."
