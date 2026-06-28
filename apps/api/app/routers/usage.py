import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_seller
from app.exceptions import ToolNotFoundError
from app.models.user import User
from app.schemas.usage import Granularity, UsageSummaryResponse
from app.services import tool_service, usage_service

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("/me", response_model=UsageSummaryResponse)
async def get_my_usage(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    start_date: Annotated[date | None, Query()] = None,
    end_date: Annotated[date | None, Query()] = None,
    tool_id: Annotated[uuid.UUID | None, Query()] = None,
    granularity: Annotated[Granularity, Query()] = "day",
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
    db: Annotated[AsyncSession, Depends(get_db)],
    start_date: Annotated[date | None, Query()] = None,
    end_date: Annotated[date | None, Query()] = None,
    granularity: Annotated[Granularity, Query()] = "day",
) -> UsageSummaryResponse:
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))

    return await usage_service.get_usage_summary_for_tool(
        db=db,
        tool_id=tool_id,
        start_date=start_date,
        end_date=end_date,
        granularity=granularity,
    )
