import math
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_redis, require_admin
from app.exceptions import AppError, ToolNotFoundError
from app.models.tool import ToolStatus
from app.models.user import User
from app.schemas.tool import AdminToolReviewUpdate, ToolListResponse, ToolResponse
from app.services import tool_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/tools",
    response_model=ToolListResponse,
    summary="List tools visible to admin review",
)
async def list_admin_tools(
    _admin: Annotated[User, Depends(require_admin)],
    status_filter: ToolStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolListResponse:
    tools, total = await tool_service.list_admin_tools(db, status_filter, page, limit)
    slugs = [tool.slug for tool in tools]
    views = await tool_service.get_view_counts(redis, slugs)

    return ToolListResponse(
        items=[
            ToolResponse.model_validate(tool).model_copy(update={"view_count": views.get(tool.slug, 0)})
            for tool in tools
        ],
        total=total,
        page=page,
        limit=limit,
        pages=math.ceil(total / limit) if total else 0,
    )


@router.patch(
    "/tools/{tool_id}/review",
    response_model=ToolResponse,
    summary="Apply an admin review decision to a tool",
)
async def update_admin_tool_review(
    tool_id: uuid.UUID,
    body: AdminToolReviewUpdate,
    _admin: Annotated[User, Depends(require_admin)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolResponse:
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if body.status == ToolStatus.live and not tool.api_endpoint:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            error_code="tool_not_deployed",
            message="A tool must have a deployed API endpoint before it can be approved live.",
        )

    updated = await tool_service.update_tool_review_status(
        db,
        tool,
        status=ToolStatus(body.status),
        processing_error=body.processing_error,
        is_featured=body.is_featured,
        redis=redis,
    )
    view_count = await tool_service.get_view_count(redis, updated.slug)
    return ToolResponse.model_validate(updated).model_copy(update={"view_count": view_count})
