from pydantic import BaseModel, ConfigDict, Field, field_validator


class AuthSyncRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    username: str | None = Field(default=None, min_length=2, max_length=50)
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    avatar_url: str | None = Field(default=None, max_length=500)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("Enter a valid email address.")
        return normalized


class AuthSyncResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    clerk_id: str
    email: str
    username: str
    display_name: str
    avatar_url: str | None = None
    role: str
    is_active: bool
