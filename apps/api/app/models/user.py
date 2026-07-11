import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.api_key import APIKey
    from app.models.tool import Tool
    from app.models.tool_purchase import ToolPurchase
    from app.models.transaction import Transaction
    from app.models.usage_log import UsageLog


class UserRole(str, enum.Enum):
    seller = "seller"
    buyer = "buyer"
    both = "both"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    username: Mapped[str] = mapped_column(String, unique=True)
    display_name: Mapped[str] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    stripe_connect_id: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="userrole"),
        default=UserRole.both,
        server_default=UserRole.both.value,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    tools: Mapped[list["Tool"]] = relationship(
        "Tool", back_populates="seller", foreign_keys="Tool.seller_id"
    )
    api_keys: Mapped[list["APIKey"]] = relationship("APIKey", back_populates="user")
    usage_logs: Mapped[list["UsageLog"]] = relationship("UsageLog", back_populates="user")
    purchases_as_buyer: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="buyer", foreign_keys="Transaction.buyer_id"
    )
    purchases_as_seller: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="seller", foreign_keys="Transaction.seller_id"
    )
    tool_purchases_as_buyer: Mapped[list["ToolPurchase"]] = relationship(
        "ToolPurchase", back_populates="buyer", foreign_keys="ToolPurchase.buyer_id"
    )
    tool_purchases_as_seller: Mapped[list["ToolPurchase"]] = relationship(
        "ToolPurchase", back_populates="seller", foreign_keys="ToolPurchase.seller_id"
    )
