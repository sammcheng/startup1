"""initial schema

Revision ID: 0001
Revises:
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Enum type definitions (created explicitly for clean downgrade)
# ---------------------------------------------------------------------------
userrole_enum = postgresql.ENUM(
    "seller", "buyer", "both", "admin", name="userrole", create_type=False
)
toolcategory_enum = postgresql.ENUM(
    "nlp", "computer_vision", "data_analysis", "automation", "generation", "other",
    name="toolcategory", create_type=False,
)
toolstatus_enum = postgresql.ENUM(
    "draft", "processing", "live", "paused", "rejected",
    name="toolstatus", create_type=False,
)
ownershiptype_enum = postgresql.ENUM(
    "royalty", "full_sale", name="ownershiptype", create_type=False
)
inputtype_enum = postgresql.ENUM(
    "text", "image", "json", "csv", "url", "file",
    name="inputtype", create_type=False,
)
outputtype_enum = postgresql.ENUM(
    "json", "text", "image", "csv", "file",
    name="outputtype", create_type=False,
)
transactiontype_enum = postgresql.ENUM(
    "usage", "full_purchase", name="transactiontype", create_type=False
)
transactionstatus_enum = postgresql.ENUM(
    "pending", "completed", "failed", "refunded",
    name="transactionstatus", create_type=False,
)
purchasestatus_enum = postgresql.ENUM(
    "pending", "active", "terminated", name="purchasestatus", create_type=False
)

ALL_ENUMS = [
    userrole_enum,
    toolcategory_enum,
    toolstatus_enum,
    ownershiptype_enum,
    inputtype_enum,
    outputtype_enum,
    transactiontype_enum,
    transactionstatus_enum,
    purchasestatus_enum,
]


def upgrade() -> None:
    conn = op.get_bind()
    for e in ALL_ENUMS:
        e.create(conn, checkfirst=True)

    # ------------------------------------------------------------------
    # users
    # ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("clerk_id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column(
            "role",
            userrole_enum,
            server_default="both",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("clerk_id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("username"),
    )
    op.create_index("ix_users_clerk_id", "users", ["clerk_id"])

    # ------------------------------------------------------------------
    # tools
    # ------------------------------------------------------------------
    op.create_table(
        "tools",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("tagline", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", toolcategory_enum, nullable=False),
        sa.Column("status", toolstatus_enum, server_default="draft", nullable=False),
        sa.Column("ownership_type", ownershiptype_enum, nullable=False),
        sa.Column("input_type", inputtype_enum, nullable=False),
        sa.Column("output_type", outputtype_enum, nullable=False),
        sa.Column("input_schema", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("output_schema", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("price_per_request", sa.Numeric(10, 6), nullable=False),
        sa.Column("demo_url", sa.String(), nullable=True),
        sa.Column("api_endpoint", sa.String(), nullable=True),
        sa.Column("docker_image_uri", sa.String(), nullable=True),
        sa.Column("github_url", sa.String(), nullable=True),
        sa.Column("documentation", sa.Text(), nullable=True),
        sa.Column("avg_response_time_ms", sa.Integer(), nullable=True),
        sa.Column("total_requests", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("uptime_percentage", sa.Numeric(5, 2), nullable=True),
        sa.Column("is_featured", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["seller_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_tools_slug", "tools", ["slug"])
    op.create_index("ix_tools_status", "tools", ["status"])

    # ------------------------------------------------------------------
    # api_keys
    # ------------------------------------------------------------------
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key_hash", sa.String(), nullable=False),
        sa.Column("key_prefix", sa.String(8), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"])

    # ------------------------------------------------------------------
    # usage_logs
    # ------------------------------------------------------------------
    op.create_table(
        "usage_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("response_time_ms", sa.Integer(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("input_size_bytes", sa.Integer(), nullable=False),
        sa.Column("output_size_bytes", sa.Integer(), nullable=False),
        sa.Column("cost", sa.Numeric(10, 6), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["api_key_id"], ["api_keys.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usage_logs_request_timestamp", "usage_logs", ["request_timestamp"])

    # ------------------------------------------------------------------
    # transactions
    # ------------------------------------------------------------------
    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("platform_fee", sa.Numeric(10, 2), nullable=False),
        sa.Column("seller_payout", sa.Numeric(10, 2), nullable=False),
        sa.Column("stripe_payment_intent_id", sa.String(), nullable=True),
        sa.Column("type", transactiontype_enum, nullable=False),
        sa.Column(
            "status",
            transactionstatus_enum,
            server_default="pending",
            nullable=False,
        ),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["buyer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["seller_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------
    # tool_purchases
    # ------------------------------------------------------------------
    op.create_table(
        "tool_purchases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("buyer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purchase_price", sa.Numeric(10, 2), nullable=False),
        sa.Column("purchase_type", ownershiptype_enum, nullable=False),
        sa.Column("contract_url", sa.String(), nullable=True),
        sa.Column(
            "status",
            purchasestatus_enum,
            server_default="pending",
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["buyer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["seller_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    # Drop tables in reverse dependency order
    op.drop_table("tool_purchases")
    op.drop_table("transactions")
    op.drop_index("ix_usage_logs_request_timestamp", table_name="usage_logs")
    op.drop_table("usage_logs")
    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.drop_table("api_keys")
    op.drop_index("ix_tools_status", table_name="tools")
    op.drop_index("ix_tools_slug", table_name="tools")
    op.drop_table("tools")
    op.drop_index("ix_users_clerk_id", table_name="users")
    op.drop_table("users")

    # Drop enum types in reverse order
    conn = op.get_bind()
    for e in reversed(ALL_ENUMS):
        e.drop(conn, checkfirst=True)
