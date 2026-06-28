import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.exceptions import AppError
from app.models.user import User
from app.schemas.api_key import APIKeyCreateRequest, APIKeyCreateResponse, APIKeyListItem
from app.services import api_key_service

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


@router.post("", response_model=APIKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: APIKeyCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> APIKeyCreateResponse:
    api_key, raw_key = await api_key_service.create_api_key(db, current_user.id, body.name)
    return APIKeyCreateResponse(
        id=api_key.id,
        key=raw_key,
        key_prefix=api_key.key_prefix,
        name=api_key.name,
    )


@router.get("", response_model=list[APIKeyListItem])
async def list_api_keys(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[APIKeyListItem]:
    api_keys = await api_key_service.list_api_keys(db, current_user.id)
    return [APIKeyListItem.model_validate(api_key) for api_key in api_keys]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    api_key = await api_key_service.get_api_key_for_user(db, key_id, current_user.id)
    if not api_key:
        raise AppError(
            message="API key not found.",
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="api_key_not_found",
        )

    await api_key_service.deactivate_api_key(db, api_key)
