import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.exceptions import AppError, Forbidden
from app.models import APIKey, User
from app.utils import hashing


async def create_api_key(db: AsyncSession, user_id: uuid.UUID, name: str) -> tuple[APIKey, str]:
    if hasattr(db, "execute"):
        await _lock_user_for_api_key_create(db, user_id)
        active_count = await count_active_api_keys(db, user_id)
        if active_count >= settings.max_active_api_keys_per_user:
            raise AppError(
                message=f"You can have at most {settings.max_active_api_keys_per_user} active API keys.",
                status_code=409,
                error_code="api_key_limit_reached",
                details={"max_active_keys": settings.max_active_api_keys_per_user},
            )

    raw_key = hashing.generate_api_key()
    api_key = APIKey(
        user_id=user_id,
        key_hash=hashing.hash_api_key(raw_key),
        key_prefix=hashing.key_prefix(raw_key),
        name=name,
    )
    db.add(api_key)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise Forbidden(
            "An API key with this configuration could not be created right now."
        ) from exc
    await db.refresh(api_key)
    return api_key, raw_key


async def _lock_user_for_api_key_create(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())


async def count_active_api_keys(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count(APIKey.id)).where(
            APIKey.user_id == user_id,
            APIKey.is_active.is_(True),
        )
    )
    return int(result.scalar_one() or 0)


async def list_api_keys(db: AsyncSession, user_id: uuid.UUID) -> list[APIKey]:
    result = await db.execute(
        select(APIKey).where(APIKey.user_id == user_id).order_by(APIKey.created_at.desc())
    )
    return list(result.scalars())


async def get_api_key_by_id(db: AsyncSession, key_id: uuid.UUID) -> APIKey | None:
    result = await db.execute(select(APIKey).where(APIKey.id == key_id))
    return result.scalar_one_or_none()


async def get_api_key_for_user(
    db: AsyncSession, key_id: uuid.UUID, user_id: uuid.UUID
) -> APIKey | None:
    result = await db.execute(
        select(APIKey).where(
            APIKey.id == key_id,
            APIKey.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def deactivate_api_key(db: AsyncSession, api_key: APIKey) -> APIKey:
    api_key.is_active = False
    await db.commit()
    await db.refresh(api_key)
    return api_key
