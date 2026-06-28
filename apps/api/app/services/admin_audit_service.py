from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import AdminAuditLog


async def record_admin_action(
    db: AsyncSession,
    *,
    admin_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: uuid.UUID | None,
    details: dict[str, Any] | None = None,
) -> AdminAuditLog:
    log = AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log


async def list_admin_audit_logs(
    db: AsyncSession,
    *,
    page: int,
    limit: int,
) -> tuple[list[AdminAuditLog], int]:
    offset = (page - 1) * limit
    items_result = await db.execute(
        select(AdminAuditLog)
        .options(selectinload(AdminAuditLog.admin))
        .order_by(AdminAuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    total_result = await db.execute(select(func.count()).select_from(AdminAuditLog))
    return list(items_result.scalars()), total_result.scalar_one()
