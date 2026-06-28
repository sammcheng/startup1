from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.models.user import UserRole


async def list_admin_users(
    db: AsyncSession,
    *,
    search: str | None,
    role_filter: UserRole | None,
    is_active: bool | None,
    page: int,
    limit: int,
) -> tuple[list[User], int]:
    """Return users for admin moderation, newest first."""
    base_query = select(User)
    count_query = select(func.count()).select_from(User)

    filters = []
    if search:
        pattern = f"%{search.strip().lower()}%"
        filters.append(
            or_(
                func.lower(User.email).like(pattern),
                func.lower(User.username).like(pattern),
                func.lower(User.display_name).like(pattern),
            )
        )
    if role_filter is not None:
        filters.append(User.role == role_filter)
    if is_active is not None:
        filters.append(User.is_active.is_(is_active))

    for condition in filters:
        base_query = base_query.where(condition)
        count_query = count_query.where(condition)

    offset = (page - 1) * limit
    items_result = await db.execute(
        base_query.order_by(User.created_at.desc()).offset(offset).limit(limit)
    )
    total_result = await db.execute(count_query)
    return list(items_result.scalars()), total_result.scalar_one()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def update_user_admin_state(
    db: AsyncSession,
    user: User,
    *,
    role: UserRole | None = None,
    is_active: bool | None = None,
) -> User:
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active

    await db.commit()
    await db.refresh(user)
    return user
