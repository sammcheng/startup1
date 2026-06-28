import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, require_seller
from app.exceptions import ToolNotFoundError
from app.models.user import User
from app.schemas.seller import (
    SellerAnalyticsResponse,
    SellerDashboardResponse,
    SellerSubmissionStatusResponse,
)
from app.services import job_service, seller_service, tool_service

router = APIRouter(prefix="/seller", tags=["seller"])


@router.get("/dashboard", response_model=SellerDashboardResponse)
async def get_seller_dashboard(
    current_user: Annotated[User, Depends(require_seller)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SellerDashboardResponse:
    return await seller_service.get_seller_dashboard(db, current_user.id)


@router.get("/tools/{tool_id}/analytics", response_model=SellerAnalyticsResponse)
async def get_tool_analytics(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_seller)],
    db: Annotated[AsyncSession, Depends(get_db)],
    period: Annotated[str, Query(pattern="^(7d|30d|90d|all)$")] = "30d",
) -> SellerAnalyticsResponse:
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))

    return await seller_service.get_tool_analytics(db, tool_id, period)


@router.get("/submissions/{tool_id}/status", response_model=SellerSubmissionStatusResponse)
async def get_submission_status(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_seller)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SellerSubmissionStatusResponse:
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))

    job = await job_service.get_latest_tool_job(db, tool_id)
    return SellerSubmissionStatusResponse(tool=tool, job=job)
