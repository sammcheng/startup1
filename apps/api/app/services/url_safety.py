from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.config import settings
from app.exceptions import AppError


BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal")


def _is_private_ip_literal(hostname: str) -> bool:
    try:
        address = ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        return False
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def _is_blocked_hostname(hostname: str) -> bool:
    normalized = hostname.strip().strip(".").lower()
    return (
        normalized in BLOCKED_HOSTNAMES
        or normalized.endswith(BLOCKED_SUFFIXES)
        or _is_private_ip_literal(normalized)
    )


def validate_public_tool_endpoint(endpoint_url: str) -> str:
    """Validate a seller-provided tool URL before the API calls it.

    Development can still point at local tools. Production must only proxy to
    public HTTPS endpoints to avoid SSRF against internal network services.
    """
    normalized = endpoint_url.rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AppError(
            message="Enter a valid deployed API URL.",
            status_code=422,
            error_code="invalid_deployment_url",
        )

    if settings.environment != "production":
        return normalized

    if parsed.scheme != "https":
        raise AppError(
            message="Production tool endpoints must use HTTPS.",
            status_code=422,
            error_code="insecure_deployment_url",
        )

    if _is_blocked_hostname(parsed.hostname):
        raise AppError(
            message="Production tool endpoints must be public internet URLs.",
            status_code=422,
            error_code="unsafe_deployment_url",
        )

    return normalized
