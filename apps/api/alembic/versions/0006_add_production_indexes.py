"""Add production performance indexes

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-07
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # usage_logs: common query patterns (user dashboard, billing aggregation)
    op.create_index("ix_usage_logs_user_id", "usage_logs", ["user_id"])
    op.create_index("ix_usage_logs_tool_id", "usage_logs", ["tool_id"])
    op.create_index(
        "ix_usage_logs_user_timestamp",
        "usage_logs",
        ["user_id", "request_timestamp"],
    )
    op.create_index(
        "ix_usage_logs_tool_timestamp",
        "usage_logs",
        ["tool_id", "request_timestamp"],
    )

    # api_keys: lookup by user
    op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])

    # tools: seller dashboard queries
    op.create_index("ix_tools_seller_id", "tools", ["seller_id"])
    op.create_index("ix_tools_category", "tools", ["category"])
    op.create_index(
        "ix_tools_status_featured",
        "tools",
        ["status", "is_featured"],
    )

    # transactions: billing queries
    op.create_index("ix_transactions_buyer_id", "transactions", ["buyer_id"])
    op.create_index("ix_transactions_seller_id", "transactions", ["seller_id"])
    op.create_index(
        "ix_transactions_stripe_pi",
        "transactions",
        ["stripe_payment_intent_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_stripe_pi", table_name="transactions")
    op.drop_index("ix_transactions_seller_id", table_name="transactions")
    op.drop_index("ix_transactions_buyer_id", table_name="transactions")
    op.drop_index("ix_tools_status_featured", table_name="tools")
    op.drop_index("ix_tools_category", table_name="tools")
    op.drop_index("ix_tools_seller_id", table_name="tools")
    op.drop_index("ix_api_keys_user_id", table_name="api_keys")
    op.drop_index("ix_usage_logs_tool_timestamp", table_name="usage_logs")
    op.drop_index("ix_usage_logs_user_timestamp", table_name="usage_logs")
    op.drop_index("ix_usage_logs_tool_id", table_name="usage_logs")
    op.drop_index("ix_usage_logs_user_id", table_name="usage_logs")
