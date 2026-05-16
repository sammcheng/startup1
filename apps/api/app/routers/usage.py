import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_seller
from app.exceptions import Forbidden, ToolNotFoundError
from app.models.user import User
from app.schemas.usage import Granularity, UsageSummaryResponse
from app.services import tool_service, usage_service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/me", response_model=UsageSummaryResponse)
async def get_my_usage(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    tool_id: uuid.UUID | None = Query(default=None),
    granularity: Granularity = Query(default="day"),
) -> UsageSummaryResponse:
    return await usage_service.get_usage_summary_for_user(
        db=db,
        user_id=current_user.id,
        start_date=start_date,
        end_date=end_date,
        tool_id=tool_id,
        granularity=granularity,
    )


@router.get("/tools/{tool_id}", response_model=UsageSummaryResponse)
async def get_tool_usage(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_seller)],
    db: AsyncSession = Depends(get_db),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    granularity: Granularity = Query(default="day"),
) -> UsageSummaryResponse:
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.seller_id != current_user.id:
        raise Forbidden("You do not own this tool.")

    return await usage_service.get_usage_summary_for_tool(
        db=db,
        tool_id=tool_id,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )
