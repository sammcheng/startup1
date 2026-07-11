import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.api_key import APIKey
    from app.models.tool import Tool
    from app.models.user import User


class UsageLog(Base):
    __tablename__ = "usage_logs"
    __table_args__ = (
        Index("ix_usage_logs_request_timestamp", "request_timestamp"),
        Index("ix_usage_logs_user_id", "user_id"),
        Index("ix_usage_logs_tool_id", "tool_id"),
        Index("ix_usage_logs_user_timestamp", "user_id", "request_timestamp"),
        Index("ix_usage_logs_tool_timestamp", "tool_id", "request_timestamp"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    api_key_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    )
    tool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tools.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    request_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    response_time_ms: Mapped[int] = mapped_column(Integer)
    status_code: Mapped[int] = mapped_column(Integer)
    input_size_bytes: Mapped[int] = mapped_column(Integer)
    output_size_bytes: Mapped[int] = mapped_column(Integer)
    cost: Mapped[Decimal] = mapped_column(Numeric(10, 6))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    api_key: Mapped["APIKey"] = relationship("APIKey", back_populates="usage_logs")
    tool: Mapped["Tool"] = relationship("Tool", back_populates="api_key_usage")
    user: Mapped["User"] = relationship("User", back_populates="usage_logs")
