import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class APIKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class APIKeyCreateResponse(BaseModel):
    id: uuid.UUID
    key: str
    key_prefix: str
    name: str


class APIKeyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key_prefix: str
    name: str
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime
