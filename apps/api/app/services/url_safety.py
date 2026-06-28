from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from app.config import settings
from app.exceptions import AppError


BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal")


def _is_unsafe_ip_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def _parse_ip_literal(hostname: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(hostname.strip("[]"))
    except ValueError:
        return None


def _is_private_ip_literal(hostname: str) -> bool:
    address = _parse_ip_literal(hostname)
    return address is not None and _is_unsafe_ip_address(address)


def _is_blocked_hostname(hostname: str) -> bool:
    normalized = hostname.strip().strip(".").lower()
    return (
        normalized in BLOCKED_HOSTNAMES
        or normalized.endswith(BLOCKED_SUFFIXES)
        or _is_private_ip_literal(normalized)
    )


def _resolve_hostname_addresses(hostname: str, port: int) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        records = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise AppError(
            message="We couldn't resolve that deployed API hostname.",
            status_code=422,
            error_code="deployment_dns_unresolved",
        ) from exc

    addresses: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    for record in records:
        sockaddr = record[4]
        if not sockaddr:
            continue
        try:
            addresses.add(ipaddress.ip_address(sockaddr[0]))
        except ValueError:
            continue

    if not addresses:
        raise AppError(
            message="We couldn't resolve that deployed API hostname.",
            status_code=422,
            error_code="deployment_dns_unresolved",
        )

    return addresses


def _validate_resolved_public_addresses(hostname: str, port: int) -> None:
    literal = _parse_ip_literal(hostname)
    addresses = {literal} if literal is not None else _resolve_hostname_addresses(hostname, port)
    if any(address is None or _is_unsafe_ip_address(address) for address in addresses):
        raise AppError(
            message="Production tool endpoints must resolve to public internet addresses.",
            status_code=422,
            error_code="unsafe_deployment_url",
        )


def _validate_public_tool_endpoint_without_dns(endpoint_url: str) -> tuple[str, str, int]:
    """Validate URL syntax and host deny-list rules, returning DNS inputs."""
    normalized = endpoint_url.rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise AppError(
            message="Enter a valid deployed API URL.",
            status_code=422,
            error_code="invalid_deployment_url",
        )

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise AppError(
            message="Enter a valid deployed API URL.",
            status_code=422,
            error_code="invalid_deployment_url",
        ) from exc

    if settings.environment != "production":
        return normalized, parsed.hostname, port

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

    return normalized, parsed.hostname, port


def validate_public_tool_endpoint(endpoint_url: str) -> str:
    """Validate a seller-provided tool URL before the API calls it.

    Development can still point at local tools. Production must only proxy to
    public HTTPS endpoints to avoid SSRF against internal network services.
    """
    normalized, hostname, port = _validate_public_tool_endpoint_without_dns(endpoint_url)
    if settings.environment == "production":
        _validate_resolved_public_addresses(hostname, port)

    return normalized


async def validate_public_tool_endpoint_async(endpoint_url: str) -> str:
    normalized, hostname, port = _validate_public_tool_endpoint_without_dns(endpoint_url)
    if settings.environment == "production":
        await asyncio.to_thread(_validate_resolved_public_addresses, hostname, port)

    return normalized
