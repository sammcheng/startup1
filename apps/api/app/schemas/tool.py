import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from app.models.tool import InputType, OutputType, OwnershipType, ToolCategory, ToolStatus


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ToolCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    tagline: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    category: ToolCategory
    ownership_type: OwnershipType
    input_type: InputType | None = None
    output_type: OutputType | None = None
    price_per_request: Decimal | None = Field(default=None, ge=0, decimal_places=6)
    one_time_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    input_schema: dict | None = None
    output_schema: dict | None = None
    environment_variables: list[dict[str, str]] | None = None
    github_url: str | None = None
    demo_url: str | None = None
    entry_command: str | None = None
    port: int = Field(default=8080, ge=1, le=65535)
    documentation: str | None = None


class ToolUpdate(BaseModel):
    """All fields are optional — only provided fields are updated."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    tagline: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    category: ToolCategory | None = None
    status: ToolStatus | None = None
    input_type: InputType | None = None
    output_type: OutputType | None = None
    ownership_type: OwnershipType | None = None
    price_per_request: Decimal | None = Field(default=None, ge=0, decimal_places=6)
    one_time_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    input_schema: dict | None = None
    output_schema: dict | None = None
    environment_variables: list[dict[str, str]] | None = None
    github_url: str | None = None
    demo_url: str | None = None
    api_endpoint: str | None = None
    docker_image_uri: str | None = None
    source_s3_key: str | None = None
    config_s3_key: str | None = None
    entry_command: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    processing_error: str | None = None
    source_file_tree: list[str] | None = None
    documentation: str | None = None


class AdminToolReviewUpdate(BaseModel):
    status: Literal["draft", "processing", "live", "paused", "rejected"]
    processing_error: str | None = Field(default=None, max_length=5000)
    is_featured: bool | None = None


class EnvironmentVariable(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=5000)


class ToolUploadGithubRequest(BaseModel):
    github_url: HttpUrl

    @field_validator("github_url")
    @classmethod
    def validate_github_url(cls, value: HttpUrl) -> HttpUrl:
        if value.host not in {"github.com", "www.github.com"}:
            raise ValueError("github_url must point to github.com.")
        return value


class ToolConfigureRequest(BaseModel):
    input_schema: dict = Field(default_factory=dict)
    output_schema: dict = Field(default_factory=dict)
    environment_variables: list[EnvironmentVariable] = Field(default_factory=list)
    entry_command: str | None = Field(default=None, min_length=1, max_length=500)
    port: int = Field(default=8080, ge=1, le=65535)
    deployment_url: HttpUrl | None = None

    @field_validator("deployment_url")
    @classmethod
    def validate_deployment_url(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value and value.scheme not in {"http", "https"}:
            raise ValueError("deployment_url must use http or https.")
        return value


class ToolUploadResponse(BaseModel):
    tool_id: uuid.UUID
    job_id: uuid.UUID | None = None
    status: ToolStatus
    status_url: str
    source_file_tree: list[str] | None = None


class ToolStatusResponse(BaseModel):
    tool_id: uuid.UUID
    status: ToolStatus
    error_message: str | None = None
    api_endpoint: str | None = None
    source_file_tree: list[str] | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class SellerInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    avatar_url: str | None = None
    username: str


class ToolResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seller_id: uuid.UUID
    seller: SellerInfo
    name: str
    slug: str
    tagline: str
    description: str
    category: ToolCategory
    status: ToolStatus
    ownership_type: OwnershipType
    input_type: InputType | None = None
    output_type: OutputType | None = None
    input_schema: dict | None = None
    output_schema: dict | None = None
    environment_variables: list[dict[str, str]] | None = None
    source_file_tree: list[str] | None = None
    price_per_request: Decimal | None = None
    one_time_price: Decimal | None = None
    demo_url: str | None = None
    api_endpoint: str | None = None
    docker_image_uri: str | None = None
    github_url: str | None = None
    source_s3_key: str | None = None
    config_s3_key: str | None = None
    entry_command: str | None = None
    port: int
    processing_error: str | None = None
    documentation: str | None = None
    avg_response_time_ms: int | None = None
    total_requests: int
    uptime_percentage: Decimal | None = None
    is_featured: bool
    view_count: int = 0
    created_at: datetime
    updated_at: datetime


class ToolListResponse(BaseModel):
    items: list[ToolResponse]
    total: int
    page: int
    limit: int
    pages: int


# ---------------------------------------------------------------------------
# Discovery (kc-style server-side keyword scoring)
# ---------------------------------------------------------------------------


class ToolDiscoverRequest(BaseModel):
    query: str = Field(min_length=0, max_length=500)
    categories: list[ToolCategory] | None = None
    limit: int = Field(default=12, ge=1, le=24)


class ToolMatch(BaseModel):
    tool: ToolResponse
    fit_line: str
    match_score: float
    matched_keywords: list[str]
    source: Literal["verified", "preview"] = "verified"


class ToolDiscoverResponse(BaseModel):
    matches: list[ToolMatch]
    query: str


# ---------------------------------------------------------------------------
# Single-call submit (kc-style: paste GitHub URL → analyzed draft listing)
# ---------------------------------------------------------------------------


class ToolSubmitRequest(BaseModel):
    github_url: HttpUrl
    submitter_email: str | None = None

    @field_validator("github_url")
    @classmethod
    def validate_github_url(cls, value: HttpUrl) -> HttpUrl:
        if value.host not in {"github.com", "www.github.com"}:
            raise ValueError("github_url must point to github.com.")
        return value


class ToolSubmitAnalysis(BaseModel):
    """Raw analyzer output preserved alongside the created tool row so the
    frontend review form can show the source-of-truth values it used to
    populate fields (especially the kc-shape fields that don't map 1:1)."""

    name: str
    description: str
    category: str
    tech_stack: list[str]
    input_contract: str
    output_contract: str
    complexity: str
    suggested_price_cents: int
    pricing_model: str


class ToolSubmitResponse(BaseModel):
    tool: ToolResponse
    analysis: ToolSubmitAnalysis
    message: str


# ---------------------------------------------------------------------------
# Query-parameter schema (used via Depends in router)
# ---------------------------------------------------------------------------

SortBy = Literal["popular", "newest", "price_low", "price_high"]


class ToolFilters(BaseModel):
    category: ToolCategory | None = None
    min_price: Decimal | None = Field(default=None, ge=0)
    max_price: Decimal | None = Field(default=None, ge=0)
    search: str | None = Field(default=None, max_length=100)
    is_featured: bool | None = None
    sort_by: SortBy = "newest"
