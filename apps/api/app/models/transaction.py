import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.tool import Tool
    from app.models.user import User


class TransactionType(str, enum.Enum):
    usage = "usage"
    full_purchase = "full_purchase"


class TransactionStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    refunded = "refunded"


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_buyer_id", "buyer_id"),
        Index("ix_transactions_seller_id", "seller_id"),
        Index("ix_transactions_stripe_pi", "stripe_payment_intent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    seller_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    tool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tools.id", ondelete="RESTRICT"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    platform_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    seller_payout: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType, name="transactiontype"))
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(TransactionStatus, name="transactionstatus"),
        default=TransactionStatus.pending,
        server_default=TransactionStatus.pending.value,
    )
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Relationships
    buyer: Mapped["User"] = relationship(
        "User", back_populates="purchases_as_buyer", foreign_keys=[buyer_id]
    )
    seller: Mapped["User | None"] = relationship(
        "User", back_populates="purchases_as_seller", foreign_keys=[seller_id]
    )
    tool: Mapped["Tool"] = relationship("Tool", back_populates="transactions")
