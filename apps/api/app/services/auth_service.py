from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User
from app.models.user import UserRole
from app.schemas.auth import AuthSyncRequest


@dataclass(slots=True)
class AuthIdentity:
    clerk_id: str
    email: str | None = None
    username: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None


async def sync_user_from_identity(
    db: AsyncSession,
    identity: AuthIdentity,
    profile: AuthSyncRequest | None = None,
) -> User:
    # Email ownership must come from a verified Clerk token/webhook payload in
    # production. The client sync body is only a local/test fallback for Clerk
    # JWT templates that omit email claims while developers are wiring auth.
    email = identity.email or ""
    if not email and settings.environment != "production":
        email = (profile.email if profile else "") or ""
    if not email:
        raise ValueError("An email address is required to synchronize the user.")

    result = await db.execute(select(User).where(User.clerk_id == identity.clerk_id))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            clerk_id=identity.clerk_id,
            email=email,
            username=await _build_unique_username(
                db,
                preferred=(profile.username if profile else None) or identity.username or _username_from_email(email),
                clerk_id=identity.clerk_id,
            ),
            display_name=(profile.display_name if profile else None) or identity.display_name or _display_name_from_email(email),
            avatar_url=_safe_avatar_url((profile.avatar_url if profile else None), identity.avatar_url),
            role=UserRole.both,
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    user.email = email
    user.username = await _build_unique_username(
        db,
        preferred=(profile.username if profile else None) or identity.username or user.username,
        clerk_id=identity.clerk_id,
        current_user_id=user.id,
    )
    user.display_name = (profile.display_name if profile else None) or identity.display_name or user.display_name
    user.avatar_url = _safe_avatar_url((profile.avatar_url if profile else None), identity.avatar_url, user.avatar_url)
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return user


async def _build_unique_username(
    db: AsyncSession,
    preferred: str,
    clerk_id: str,
    current_user_id=None,
) -> str:
    base = _normalize_username(preferred) or f"user-{clerk_id[-6:]}"
    candidate = base
    suffix = 1

    while True:
        result = await db.execute(select(User).where(User.username == candidate))
        existing = result.scalar_one_or_none()
        if existing is None or existing.id == current_user_id:
            return candidate
        suffix += 1
        candidate = f"{base}-{suffix}"


def _normalize_username(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    collapsed = "-".join(part for part in cleaned.split("-") if part)
    return collapsed[:50]


def _username_from_email(email: str) -> str:
    return email.split("@", 1)[0]


def _display_name_from_email(email: str) -> str:
    return _username_from_email(email).replace("-", " ").replace("_", " ").title() or "Hackmarket User"


def _safe_avatar_url(*values: str | None) -> str | None:
    for value in values:
        if not value:
            continue
        try:
            parsed = urlparse(value)
        except ValueError:
            continue
        if parsed.scheme == "https" and parsed.netloc:
            return value
    return None
