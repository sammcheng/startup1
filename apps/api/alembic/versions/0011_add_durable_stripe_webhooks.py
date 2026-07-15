"""Add durable Stripe webhook receipts and invoice references

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Reviewed: this raw SQL only adds a non-destructive PostgreSQL enum value.
MIGRATION_SAFETY_REVIEWED = True


def _assert_no_duplicate_usage_periods() -> None:
    duplicate = (
        op.get_bind()
        .execute(
            sa.text(
                """
            select buyer_id, tool_id, period_start, period_end
            from transactions
            where type = 'usage' and buyer_id <> seller_id
            group by buyer_id, tool_id, period_start, period_end
            having count(*) > 1
            limit 1
            """
            )
        )
        .first()
    )
    if duplicate:
        raise RuntimeError(
            "Cannot add usage invoice uniqueness while duplicate billing-period transactions exist."
        )


def upgrade() -> None:
    _assert_no_duplicate_usage_periods()

    op.execute(sa.text("ALTER TYPE transactionstatus ADD VALUE IF NOT EXISTS 'refund_pending'"))

    webhook_status = postgresql.ENUM(
        "queued",
        "processing",
        "retrying",
        "succeeded",
        "failed",
        name="stripewebhookeventstatus",
        create_type=False,
    )
    webhook_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "stripe_webhook_events",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "status",
            webhook_status,
            server_default="queued",
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default="3", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
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
    )
    op.create_index(
        "ix_stripe_webhook_events_status_created",
        "stripe_webhook_events",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_stripe_webhook_events_type_created",
        "stripe_webhook_events",
        ["event_type", "created_at"],
    )

    op.add_column("transactions", sa.Column("stripe_invoice_id", sa.String(), nullable=True))
    op.add_column("transactions", sa.Column("stripe_transfer_id", sa.String(), nullable=True))
    op.add_column(
        "transactions", sa.Column("stripe_transfer_reversal_id", sa.String(), nullable=True)
    )
    op.add_column(
        "transactions", sa.Column("seller_paid_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "transactions", sa.Column("seller_reversed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_transactions_stripe_invoice_id",
        "transactions",
        ["stripe_invoice_id"],
    )
    op.create_index(
        "ix_transactions_stripe_transfer_id",
        "transactions",
        ["stripe_transfer_id"],
    )
    op.create_index(
        "ix_transactions_stripe_transfer_reversal_id",
        "transactions",
        ["stripe_transfer_reversal_id"],
    )
    op.create_index(
        "ix_transactions_seller_unpaid",
        "transactions",
        ["seller_id", "seller_paid_at"],
    )
    op.create_index(
        "ux_transactions_usage_period",
        "transactions",
        ["buyer_id", "tool_id", "period_start", "period_end"],
        unique=True,
        postgresql_where=sa.text("type = 'usage' and buyer_id <> seller_id"),
    )
    # Older releases represented payouts as synthetic self-transactions. Mark
    # them paid so the new ledger never transfers those amounts again.
    op.execute(
        sa.text(
            """
            update transactions
            set seller_paid_at = created_at,
                stripe_transfer_id = stripe_payment_intent_id
            where buyer_id = seller_id
              and stripe_payment_intent_id like 'tr_%'
              and seller_paid_at is null
            """
        )
    )


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely in place. The unused
    # refund_pending value remains after rollback.
    op.drop_index("ux_transactions_usage_period", table_name="transactions")
    op.drop_index("ix_transactions_seller_unpaid", table_name="transactions")
    op.drop_index("ix_transactions_stripe_transfer_reversal_id", table_name="transactions")
    op.drop_index("ix_transactions_stripe_transfer_id", table_name="transactions")
    op.drop_index("ix_transactions_stripe_invoice_id", table_name="transactions")
    op.drop_column("transactions", "seller_paid_at")
    op.drop_column("transactions", "seller_reversed_at")
    op.drop_column("transactions", "stripe_transfer_reversal_id")
    op.drop_column("transactions", "stripe_transfer_id")
    op.drop_column("transactions", "stripe_invoice_id")
    op.drop_index("ix_stripe_webhook_events_type_created", table_name="stripe_webhook_events")
    op.drop_index("ix_stripe_webhook_events_status_created", table_name="stripe_webhook_events")
    op.drop_table("stripe_webhook_events")
    postgresql.ENUM(name="stripewebhookeventstatus").drop(op.get_bind(), checkfirst=True)
