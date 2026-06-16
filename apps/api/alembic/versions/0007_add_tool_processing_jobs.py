"""Add durable tool processing jobs

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-05
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

job_kind_enum = postgresql.ENUM(
    "tool_upload",
    name="toolprocessingjobkind",
    create_type=False,
)
job_status_enum = postgresql.ENUM(
    "queued",
    "running",
    "retrying",
    "succeeded",
    "failed",
    name="toolprocessingjobstatus",
    create_type=False,
)


def upgrade() -> None:
    conn = op.get_bind()
    job_kind_enum.create(conn, checkfirst=True)
    job_status_enum.create(conn, checkfirst=True)

    op.create_table(
        "tool_processing_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tool_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "kind",
            job_kind_enum,
            server_default="tool_upload",
            nullable=False,
        ),
        sa.Column(
            "status",
            job_status_enum,
            server_default="queued",
            nullable=False,
        ),
        sa.Column("arq_job_id", sa.String(length=160), nullable=False),
        sa.Column("trigger", sa.String(length=80), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default="3", nullable=False),
        sa.Column("payload", postgresql.JSON(astext_type=sa.Text()), nullable=True),
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
        sa.ForeignKeyConstraint(["seller_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_id"], ["tools.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("arq_job_id"),
    )
    op.create_index("ix_tool_processing_jobs_tool_id", "tool_processing_jobs", ["tool_id"])
    op.create_index("ix_tool_processing_jobs_seller_id", "tool_processing_jobs", ["seller_id"])
    op.create_index("ix_tool_processing_jobs_status", "tool_processing_jobs", ["status"])
    op.create_index(
        "ix_tool_processing_jobs_tool_created",
        "tool_processing_jobs",
        ["tool_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_tool_processing_jobs_tool_created", table_name="tool_processing_jobs")
    op.drop_index("ix_tool_processing_jobs_status", table_name="tool_processing_jobs")
    op.drop_index("ix_tool_processing_jobs_seller_id", table_name="tool_processing_jobs")
    op.drop_index("ix_tool_processing_jobs_tool_id", table_name="tool_processing_jobs")
    op.drop_table("tool_processing_jobs")

    conn = op.get_bind()
    job_status_enum.drop(conn, checkfirst=True)
    job_kind_enum.drop(conn, checkfirst=True)
