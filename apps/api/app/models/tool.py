import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ToolCategory(str, enum.Enum):
    nlp = "nlp"
    computer_vision = "computer_vision"
    data_analysis = "data_analysis"
    automation = "automation"
    generation = "generation"
    other = "other"


class ToolStatus(str, enum.Enum):
    draft = "draft"
    processing = "processing"
    live = "live"
    paused = "paused"
    rejected = "rejected"


class OwnershipType(str, enum.Enum):
    royalty = "royalty"
    full_sale = "full_sale"


class InputType(str, enum.Enum):
    text = "text"
    image = "image"
    json = "json"
    csv = "csv"
    url = "url"
    file = "file"


class OutputType(str, enum.Enum):
    json = "json"
    text = "text"
    image = "image"
    csv = "csv"
    file = "file"


class Tool(Base):
    __tablename__ = "tools"
    __table_args__ = (
        Index("ix_tools_slug", "slug"),
        Index("ix_tools_status", "status"),
        Index("ix_tools_seller_id", "seller_id"),
        Index("ix_tools_category", "category"),
        Index("ix_tools_status_featured", "status", "is_featured"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    tagline: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[ToolCategory] = mapped_column(Enum(ToolCategory, name="toolcategory"))
    status: Mapped[ToolStatus] = mapped_column(
        Enum(ToolStatus, name="toolstatus"),
        default=ToolStatus.draft,
        server_default=ToolStatus.draft.value,
    )
    ownership_type: Mapped[OwnershipType] = mapped_column(Enum(OwnershipType, name="ownershiptype"))
    input_type: Mapped[InputType | None] = mapped_column(Enum(InputType, name="inputtype"), nullable=True)
    output_type: Mapped[OutputType | None] = mapped_column(Enum(OutputType, name="outputtype"), nullable=True)
    input_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    environment_variables: Mapped[list[dict[str, str]] | None] = mapped_column(JSON, nullable=True)
    source_file_tree: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    price_per_request: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    one_time_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    demo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    api_endpoint: Mapped[str | None] = mapped_column(String, nullable=True)
    docker_image_uri: Mapped[str | None] = mapped_column(String, nullable=True)
    github_url: Mapped[str | None] = mapped_column(String, nullable=True)
    source_s3_key: Mapped[str | None] = mapped_column(String, nullable=True)
    config_s3_key: Mapped[str | None] = mapped_column(String, nullable=True)
    entry_command: Mapped[str | None] = mapped_column(String, nullable=True)
    port: Mapped[int] = mapped_column(Integer, default=8080, server_default="8080")
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    documentation: Mapped[str | None] = mapped_column(Text, nullable=True)
    avg_response_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_requests: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    uptime_percentage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    seller: Mapped["User"] = relationship("User", back_populates="tools", foreign_keys=[seller_id])
    api_key_usage: Mapped[list["UsageLog"]] = relationship("UsageLog", back_populates="tool")
    transactions: Mapped[list["Transaction"]] = relationship("Transaction", back_populates="tool")
    tool_purchases: Mapped[list["ToolPurchase"]] = relationship("ToolPurchase", back_populates="tool")
