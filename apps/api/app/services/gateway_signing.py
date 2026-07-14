from __future__ import annotations

import base64
import re
import time
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SIGNATURE_VERSION = "ed25519-v1"
SIGNATURE_HEADER = "X-HackMarket-Signature"
SIGNATURE_VERSION_HEADER = "X-HackMarket-Signature-Version"
SIGNATURE_KEY_ID_HEADER = "X-HackMarket-Signature-Key-Id"
SIGNATURE_TIMESTAMP_HEADER = "X-HackMarket-Signature-Timestamp"

INTERNAL_GATEWAY_HEADERS = {
    "x-hackmarket-request-id",
    "x-hackmarket-tool-slug",
    SIGNATURE_HEADER.lower(),
    SIGNATURE_VERSION_HEADER.lower(),
    SIGNATURE_KEY_ID_HEADER.lower(),
    SIGNATURE_TIMESTAMP_HEADER.lower(),
}

_KEY_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,64}")
_BASE64URL_PATTERN = re.compile(r"[A-Za-z0-9_-]+={0,2}")


def validate_signing_key_id(key_id: str) -> None:
    if not _KEY_ID_PATTERN.fullmatch(key_id):
        raise ValueError(
            "gateway signing key ID must contain only letters, numbers, '.', '_', or '-'"
        )


def validate_private_key(encoded_private_key: str) -> None:
    _load_private_key(encoded_private_key)


def public_key_from_private(encoded_private_key: str) -> str:
    public_bytes = (
        _load_private_key(encoded_private_key)
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )
    return _encode_base64url(public_bytes)


def build_canonical_message(
    *,
    method: str,
    request_target: str,
    timestamp: int,
    request_id: str,
    tool_slug: str,
    key_id: str,
) -> bytes:
    validate_signing_key_id(key_id)
    values = (
        SIGNATURE_VERSION,
        key_id,
        str(timestamp),
        request_id,
        tool_slug,
        method.upper(),
        request_target,
    )
    if any("\x00" in value or "\r" in value or "\n" in value for value in values):
        raise ValueError("gateway signing fields cannot contain control characters")
    if not request_target.startswith("/"):
        raise ValueError("gateway request target must start with '/'")
    return "\n".join(values).encode("utf-8")


def sign_gateway_request(
    *,
    method: str,
    request_target: str,
    request_id: str,
    tool_slug: str,
    encoded_private_key: str,
    key_id: str,
    timestamp: int | None = None,
) -> dict[str, str]:
    signed_at = int(time.time()) if timestamp is None else timestamp
    message = build_canonical_message(
        method=method,
        request_target=request_target,
        timestamp=signed_at,
        request_id=request_id,
        tool_slug=tool_slug,
        key_id=key_id,
    )
    signature = _load_private_key(encoded_private_key).sign(message)
    return {
        SIGNATURE_VERSION_HEADER: SIGNATURE_VERSION,
        SIGNATURE_KEY_ID_HEADER: key_id,
        SIGNATURE_TIMESTAMP_HEADER: str(signed_at),
        SIGNATURE_HEADER: _encode_base64url(signature),
    }


@lru_cache(maxsize=4)
def _load_private_key(encoded_private_key: str) -> Ed25519PrivateKey:
    key_bytes = _decode_base64url(encoded_private_key)
    if len(key_bytes) != 32:
        raise ValueError("gateway signing private key must decode to exactly 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(key_bytes)


def _decode_base64url(value: str) -> bytes:
    normalized = value.strip()
    if not normalized or not _BASE64URL_PATTERN.fullmatch(normalized):
        raise ValueError("gateway signing key must be valid base64url")
    unpadded = normalized.rstrip("=")
    padding = "=" * (-len(unpadded) % 4)
    try:
        return base64.urlsafe_b64decode(unpadded + padding)
    except (ValueError, TypeError) as exc:
        raise ValueError("gateway signing key must be valid base64url") from exc


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")
