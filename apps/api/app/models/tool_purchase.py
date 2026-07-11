import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.tool import OwnershipType

if TYPE_CHECKING:
    from app.models.tool import Tool
    from app.models.user import User


class PurchaseStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    terminated = "terminated"


class ToolPurchase(Base):
    __tablename__ = "tool_purchases"
    __table_args__ = (
        Index(
            "ux_tool_purchases_buyer_tool_open",
            "buyer_id",
            "tool_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'active')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tool_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tools.id", ondelete="RESTRICT"), nullable=False
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    # Reuses the ownershiptype enum since values are identical
    purchase_type: Mapped[OwnershipType] = mapped_column(Enum(OwnershipType, name="ownershiptype"))
    contract_url: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[PurchaseStatus] = mapped_column(
        Enum(PurchaseStatus, name="purchasestatus"),
        default=PurchaseStatus.pending,
        server_default=PurchaseStatus.pending.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Relationships
    tool: Mapped["Tool"] = relationship("Tool", back_populates="tool_purchases")
    buyer: Mapped["User"] = relationship(
        "User", back_populates="tool_purchases_as_buyer", foreign_keys=[buyer_id]
    )
    seller: Mapped["User"] = relationship(
        "User", back_populates="tool_purchases_as_seller", foreign_keys=[seller_id]
    )
