import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.tool import ToolStatus
from app.models.tool_processing_job import ToolProcessingJobKind, ToolProcessingJobStatus
from app.models.user import UserRole


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    clerk_id: str
    email: str
    username: str
    display_name: str
    avatar_url: str | None = None
    role: UserRole
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AdminUserListResponse(BaseModel):
    items: list[AdminUserResponse]
    total: int
    page: int
    limit: int
    pages: int


class AdminUserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None


class AdminProcessingJobResponse(BaseModel):
    id: uuid.UUID
    tool_id: uuid.UUID
    seller_id: uuid.UUID
    kind: ToolProcessingJobKind
    status: ToolProcessingJobStatus
    arq_job_id: str
    trigger: str
    attempts: int
    max_attempts: int
    payload: dict | None = None
    last_error: str | None = None
    enqueued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    tool_name: str | None = None
    tool_slug: str | None = None
    tool_status: ToolStatus | None = None
    seller_email: str | None = None


class AdminProcessingJobListResponse(BaseModel):
    items: list[AdminProcessingJobResponse]
    total: int
    page: int
    limit: int
    pages: int


class AdminProcessingJobRetryRequest(BaseModel):
    reason: str = Field(default="Admin retry", min_length=1, max_length=500)


class AdminActionResponse(BaseModel):
    status: Literal["accepted", "updated"]
    message: str
