import hashlib
import secrets


_PREFIX = "hm_live_"
_RANDOM_BYTES = 30  # produces ~40 base64url chars, total key length ~48
_DISPLAY_PREFIX_LENGTH = 12


def generate_api_key() -> str:
    """Return a new plaintext API key in the form ``hm_live_<40 random chars>``."""
    random_part = secrets.token_urlsafe(_RANDOM_BYTES)
    return f"{_PREFIX}{random_part}"


def hash_api_key(raw_key: str) -> str:
    """Return the SHA-256 hex digest of *raw_key*. Store this, never the key itself."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def verify_api_key(raw_key: str, stored_hash: str) -> bool:
    """Return True if *raw_key* hashes to *stored_hash* (constant-time compare)."""
    candidate = hash_api_key(raw_key)
    return secrets.compare_digest(candidate, stored_hash)


def key_prefix(raw_key: str) -> str:
    """Return a safe preview prefix for *raw_key* (e.g. ``hm_live_abc1``)."""
    return raw_key[:_DISPLAY_PREFIX_LENGTH]
