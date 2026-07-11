import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.tool import Tool
    from app.models.user import User


class ToolProcessingJobKind(str, enum.Enum):
    tool_upload = "tool_upload"


class ToolProcessingJobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    retrying = "retrying"
    succeeded = "succeeded"
    failed = "failed"


class ToolProcessingJob(Base):
    __tablename__ = "tool_processing_jobs"
    __table_args__ = (
        Index("ix_tool_processing_jobs_tool_id", "tool_id"),
        Index("ix_tool_processing_jobs_seller_id", "seller_id"),
        Index("ix_tool_processing_jobs_status", "status"),
        Index("ix_tool_processing_jobs_tool_created", "tool_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tools.id", ondelete="CASCADE"),
        nullable=False,
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[ToolProcessingJobKind] = mapped_column(
        Enum(ToolProcessingJobKind, name="toolprocessingjobkind"),
        default=ToolProcessingJobKind.tool_upload,
        server_default=ToolProcessingJobKind.tool_upload.value,
        nullable=False,
    )
    status: Mapped[ToolProcessingJobStatus] = mapped_column(
        Enum(ToolProcessingJobStatus, name="toolprocessingjobstatus"),
        default=ToolProcessingJobStatus.queued,
        server_default=ToolProcessingJobStatus.queued.value,
        nullable=False,
    )
    arq_job_id: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    trigger: Mapped[str] = mapped_column(String(80), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    max_attempts: Mapped[int] = mapped_column(
        Integer, default=3, server_default="3", nullable=False
    )
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    enqueued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    tool: Mapped["Tool"] = relationship("Tool", back_populates="processing_jobs")
    seller: Mapped["User"] = relationship("User")
