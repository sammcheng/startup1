import logging
import time
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urlparse

import redis.asyncio as aioredis
from fastapi import Depends, Header
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.exceptions import Forbidden, InvalidAPIKeyError, Unauthorized
from app.models import APIKey, User
from app.models.user import UserRole
from app.services.auth_service import AuthIdentity, sync_user_from_identity
from app.utils.hashing import hash_api_key, is_api_key_format

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_timeout=30,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

_redis_client: aioredis.Redis = aioredis.from_url(
    settings.redis_url,
    decode_responses=True,
    max_connections=settings.redis_max_connections,
    socket_connect_timeout=5,
    socket_timeout=5,
    retry_on_timeout=True,
)


async def get_redis() -> aioredis.Redis:
    return _redis_client


# ---------------------------------------------------------------------------
# Clerk JWT verification
# ---------------------------------------------------------------------------

# In-memory JWKS cache: {"keys": [...], "fetched_at": float}
_jwks_cache: dict[str, dict] = {}
_JWKS_TTL = 3600  # seconds before re-fetching


def _jwks_url_from_issuer(issuer: str) -> str:
    parsed = urlparse(issuer)
    if parsed.scheme != "https":
        raise Unauthorized("Unsupported token issuer.")

    host = parsed.netloc.lower()
    allowed_suffixes = (".clerk.accounts.dev", ".clerk.com", ".clerkstage.dev")
    if not (host.endswith(allowed_suffixes) or host == "clerk.com"):
        raise Unauthorized("Unsupported token issuer.")

    return f"{issuer.rstrip('/')}/.well-known/jwks.json"


def _resolve_jwks_url(token: str) -> str:
    if settings.clerk_jwks_url:
        return settings.clerk_jwks_url

    try:
        claims = jwt.get_unverified_claims(token)
    except JWTError as exc:
        raise Unauthorized("Malformed JWT claims.") from exc

    issuer = claims.get("iss")
    if not issuer or not isinstance(issuer, str):
        raise Unauthorized("Token issuer missing.")
    return _jwks_url_from_issuer(issuer)


async def _get_jwks(jwks_url: str) -> list[dict]:
    now = time.monotonic()
    cached = _jwks_cache.get(jwks_url)
    if cached and now - cached.get("fetched_at", 0) < _JWKS_TTL:
        return cached["keys"]

    from app.services.proxy_service import get_http_client
    client = get_http_client()
    resp = await client.get(jwks_url, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    _jwks_cache[jwks_url] = {"keys": data["keys"], "fetched_at": now}
    return data["keys"]


async def verify_clerk_identity(token: str) -> AuthIdentity:
    """Validate a Clerk JWT and return its decoded claims."""
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise Unauthorized("Malformed JWT.") from exc

    kid = header.get("kid")
    jwks_url = _resolve_jwks_url(token)
    keys = await _get_jwks(jwks_url)
    jwk = next((k for k in keys if k.get("kid") == kid), None)

    if jwk is None:
        # Key may have rotated — flush cache and retry once
        _jwks_cache.pop(jwks_url, None)
        keys = await _get_jwks(jwks_url)
        jwk = next((k for k in keys if k.get("kid") == kid), None)

    if jwk is None:
        raise Unauthorized("Token signing key not found.")

    try:
        claims: dict = jwt.decode(token, jwk, algorithms=["RS256"])
    except JWTError as exc:
        raise Unauthorized("Token verification failed.") from exc

    email = claims.get("email")
    if not isinstance(email, str):
        email = None

    username = claims.get("username") or claims.get("preferred_username")
    if not isinstance(username, str):
        username = None

    name = claims.get("name")
    if not isinstance(name, str):
        given_name = claims.get("given_name")
        family_name = claims.get("family_name")
        if isinstance(given_name, str) or isinstance(family_name, str):
            name = " ".join(part for part in [given_name, family_name] if isinstance(part, str) and part).strip()
        else:
            name = None

    avatar_url = claims.get("picture")
    if not isinstance(avatar_url, str):
        avatar_url = None

    return AuthIdentity(
        clerk_id=str(claims["sub"]),
        email=email,
        username=username,
        display_name=name,
        avatar_url=avatar_url,
    )


def _extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise Unauthorized("Authorization header required.")
    return authorization[len("Bearer "):]


# ---------------------------------------------------------------------------
# Core auth dependencies
# ---------------------------------------------------------------------------


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """
    Validate the Clerk Bearer JWT and return the matching active User row.
    User creation is handled by the Clerk webhook (POST /auth/webhook).
    Raises 401 if the token is invalid or the user is not found / inactive.
    """
    token = _extract_bearer(authorization)
    identity = await verify_clerk_identity(token)
    clerk_id = identity.clerk_id

    result = await db.execute(
        select(User).where(User.clerk_id == clerk_id, User.is_active.is_(True))
    )
    user = result.scalar_one_or_none()
    if not user:
        try:
            user = await sync_user_from_identity(db, identity)
        except ValueError as exc:
            raise Unauthorized("No active account found. Please complete registration.") from exc
    return user


async def get_optional_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> User | None:
    if not authorization:
        return None
    return await get_current_user(authorization=authorization, db=db)


async def get_current_identity(
    authorization: Annotated[str | None, Header()] = None,
) -> AuthIdentity:
    token = _extract_bearer(authorization)
    return await verify_clerk_identity(token)


async def require_seller(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Return the current user only if they have seller capability."""
    if current_user.role not in (UserRole.seller, UserRole.both, UserRole.admin):
        raise Forbidden("A seller account is required for this action.")
    return current_user


async def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Return the current user only if they have admin capability."""
    if current_user.role != UserRole.admin:
        raise Forbidden("An admin account is required for this action.")
    return current_user


# ---------------------------------------------------------------------------
# API-key dependency (for tool consumers)
# ---------------------------------------------------------------------------


async def validate_api_key(
    db: Annotated[AsyncSession, Depends(get_db)],
    x_api_key: Annotated[str | None, Header()] = None,
) -> tuple[User, APIKey]:
    """
    Validate the ``X-Api-Key`` header, mark it as used, and return
    ``(user, api_key)``. Raises 401 on any failure.
    """
    if not x_api_key:
        raise InvalidAPIKeyError("X-Api-Key header required.")
    if not is_api_key_format(x_api_key):
        raise InvalidAPIKeyError()

    key_hash = hash_api_key(x_api_key)
    result = await db.execute(
        select(APIKey).where(APIKey.key_hash == key_hash, APIKey.is_active.is_(True))
    )
    api_key = result.scalar_one_or_none()

    if not api_key:
        raise InvalidAPIKeyError()

    user_result = await db.execute(
        select(User).where(User.id == api_key.user_id, User.is_active.is_(True))
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise InvalidAPIKeyError("API key owner not found.")

    await db.execute(
        update(APIKey)
        .where(APIKey.id == api_key.id)
        .values(last_used_at=datetime.now(UTC))
    )
    await db.commit()

    return user, api_key
