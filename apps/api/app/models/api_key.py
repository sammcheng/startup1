import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.usage_log import UsageLog
    from app.models.user import User


class APIKey(Base):
    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ux_api_keys_key_hash", "key_hash", unique=True),
        Index("ix_api_keys_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    key_hash: Mapped[str] = mapped_column(String)
    key_prefix: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="api_keys")
    usage_logs: Mapped[list["UsageLog"]] = relationship("UsageLog", back_populates="api_key")
