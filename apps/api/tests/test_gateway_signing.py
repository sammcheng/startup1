import base64

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.services import gateway_signing

FIXED_PRIVATE_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
FIXED_PUBLIC_KEY = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w"
FIXED_SIGNATURE = (
    "D8v-Zed1aziCR8Su2cpGTEdLBvs_1ejZ4291m3BYy7I0q43d0xqdr18EXjr08eZ1vAOWzae7cKd3rj5bHkCzDQ"
)


def _private_key() -> tuple[Ed25519PrivateKey, str]:
    key = Ed25519PrivateKey.generate()
    raw = key.private_bytes_raw()
    encoded = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return key, encoded


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_sign_gateway_request_produces_verifiable_canonical_signature() -> None:
    private_key, encoded = _private_key()
    headers = gateway_signing.sign_gateway_request(
        method="post",
        request_target="/api/analyze?mode=full%20scan",
        request_id="req_123",
        tool_slug="accessibility-checker",
        encoded_private_key=encoded,
        key_id="launch-1",
        timestamp=1_800_000_000,
    )

    message = gateway_signing.build_canonical_message(
        method="POST",
        request_target="/api/analyze?mode=full%20scan",
        timestamp=1_800_000_000,
        request_id="req_123",
        tool_slug="accessibility-checker",
        key_id="launch-1",
    )
    private_key.public_key().verify(_decode(headers[gateway_signing.SIGNATURE_HEADER]), message)
    assert headers[gateway_signing.SIGNATURE_VERSION_HEADER] == "ed25519-v1"
    assert headers[gateway_signing.SIGNATURE_TIMESTAMP_HEADER] == "1800000000"


def test_signature_does_not_verify_for_a_different_target() -> None:
    private_key, encoded = _private_key()
    headers = gateway_signing.sign_gateway_request(
        method="POST",
        request_target="/api/analyze",
        request_id="req_123",
        tool_slug="accessibility-checker",
        encoded_private_key=encoded,
        key_id="launch-1",
        timestamp=1_800_000_000,
    )
    altered = gateway_signing.build_canonical_message(
        method="POST",
        request_target="/api/scrape",
        timestamp=1_800_000_000,
        request_id="req_123",
        tool_slug="accessibility-checker",
        key_id="launch-1",
    )

    with pytest.raises(InvalidSignature):
        private_key.public_key().verify(_decode(headers[gateway_signing.SIGNATURE_HEADER]), altered)


def test_public_key_is_derived_without_exposing_private_material() -> None:
    private_key, encoded = _private_key()

    public_key = gateway_signing.public_key_from_private(encoded)

    assert _decode(public_key) == private_key.public_key().public_bytes_raw()
    assert public_key != encoded


def test_signing_matches_the_cross_runtime_test_vector() -> None:
    headers = gateway_signing.sign_gateway_request(
        method="POST",
        request_target="/api/analyze?mode=full%20scan",
        request_id="req_cross_language",
        tool_slug="home-accessibility-checker",
        encoded_private_key=FIXED_PRIVATE_KEY,
        key_id="launch-1",
        timestamp=1_800_000_000,
    )

    assert gateway_signing.public_key_from_private(FIXED_PRIVATE_KEY) == FIXED_PUBLIC_KEY
    assert headers[gateway_signing.SIGNATURE_HEADER] == FIXED_SIGNATURE


@pytest.mark.parametrize("value", ["", "not+base64", "YWJj", "A" * 44])
def test_invalid_private_keys_are_rejected(value: str) -> None:
    with pytest.raises(ValueError):
        gateway_signing.validate_private_key(value)
