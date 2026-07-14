#!/usr/bin/env python3
"""Generate a local Ed25519 key pair for API-to-tool request signing."""

from __future__ import annotations

import argparse
import base64
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / ".gateway-signing-keys.env"
KEY_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,64}")


def encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the API private key and seller-service public key."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"private output file (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument("--key-id", default="launch-1")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not KEY_ID_PATTERN.fullmatch(args.key_id):
        raise SystemExit("key ID may contain only letters, numbers, '.', '_', or '-'")

    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    contents = "\n".join(
        (
            f"TOOL_GATEWAY_SIGNING_PRIVATE_KEY={encode_base64url(private_bytes)}",
            f"TOOL_GATEWAY_SIGNING_KEY_ID={args.key_id}",
            "TOOL_GATEWAY_SIGNATURE_TTL_SECONDS=300",
            f"HACKMARKET_GATEWAY_PUBLIC_KEY={encode_base64url(public_bytes)}",
            f"HACKMARKET_GATEWAY_KEY_ID={args.key_id}",
            "HACKMARKET_GATEWAY_SIGNATURE_TTL_SECONDS=300",
            "",
        )
    )

    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise SystemExit(f"refusing to overwrite existing key file: {output}") from exc

    with os.fdopen(descriptor, "w", encoding="utf-8") as key_file:
        key_file.write(contents)

    print(f"Created {output} with owner-only permissions.")
    print("Put the TOOL_GATEWAY_* private value only on the API and worker.")
    print("Put the HACKMARKET_GATEWAY_* public value on seller tool services.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
