import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.exceptions import AppError, Forbidden
from app.models import APIKey
from app.utils import hashing


async def create_api_key(db: AsyncSession, user_id: uuid.UUID, name: str) -> tuple[APIKey, str]:
    if hasattr(db, "execute"):
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
    except IntegrityError:
        await db.rollback()
        raise Forbidden("An API key with this configuration could not be created right now.")
    await db.refresh(api_key)
    return api_key, raw_key


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
        select(APIKey)
        .where(APIKey.user_id == user_id)
        .order_by(APIKey.created_at.desc())
    )
    return list(result.scalars())


async def get_api_key_by_id(db: AsyncSession, key_id: uuid.UUID) -> APIKey | None:
    result = await db.execute(select(APIKey).where(APIKey.id == key_id))
    return result.scalar_one_or_none()


async def deactivate_api_key(db: AsyncSession, api_key: APIKey) -> APIKey:
    api_key.is_active = False
    await db.commit()
    await db.refresh(api_key)
    return api_key
