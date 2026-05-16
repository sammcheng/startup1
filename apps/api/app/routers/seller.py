import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, require_seller
from app.exceptions import Forbidden, ToolNotFoundError
from app.models.user import User
from app.schemas.seller import SellerAnalyticsResponse, SellerDashboardResponse
from app.services import seller_service, tool_service

router = APIRouter(prefix="/seller", tags=["seller"])


@router.get("/dashboard", response_model=SellerDashboardResponse)
async def get_seller_dashboard(
    current_user: Annotated[User, Depends(require_seller)],
    db: AsyncSession = Depends(get_db),
) -> SellerDashboardResponse:
    return await seller_service.get_seller_dashboard(db, current_user.id)


@router.get("/tools/{tool_id}/analytics", response_model=SellerAnalyticsResponse)
async def get_tool_analytics(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_seller)],
    period: str = Query(default="30d", pattern="^(7d|30d|90d|all)$"),
    db: AsyncSession = Depends(get_db),
) -> SellerAnalyticsResponse:
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if tool.seller_id != current_user.id:
        raise Forbidden("You do not own this tool.")

    return await seller_service.get_tool_analytics(db, tool_id, period)
