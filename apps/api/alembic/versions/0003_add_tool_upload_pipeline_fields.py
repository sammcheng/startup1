"""add tool upload pipeline fields

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-29 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tools",
        sa.Column("environment_variables", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("source_file_tree", postgresql.JSON(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("tools", sa.Column("one_time_price", sa.Numeric(10, 2), nullable=True))
    op.add_column("tools", sa.Column("source_s3_key", sa.String(), nullable=True))
    op.add_column("tools", sa.Column("config_s3_key", sa.String(), nullable=True))
    op.add_column("tools", sa.Column("entry_command", sa.String(), nullable=True))
    op.add_column(
        "tools",
        sa.Column("port", sa.Integer(), server_default="8080", nullable=False),
    )
    op.add_column("tools", sa.Column("processing_error", sa.Text(), nullable=True))

    op.alter_column("tools", "input_type", existing_type=postgresql.ENUM(name="inputtype"), nullable=True)
    op.alter_column("tools", "output_type", existing_type=postgresql.ENUM(name="outputtype"), nullable=True)
    op.alter_column("tools", "price_per_request", existing_type=sa.Numeric(10, 6), nullable=True)


def downgrade() -> None:
    op.alter_column("tools", "price_per_request", existing_type=sa.Numeric(10, 6), nullable=False)
    op.alter_column("tools", "output_type", existing_type=postgresql.ENUM(name="outputtype"), nullable=False)
    op.alter_column("tools", "input_type", existing_type=postgresql.ENUM(name="inputtype"), nullable=False)

    op.drop_column("tools", "processing_error")
    op.drop_column("tools", "port")
    op.drop_column("tools", "entry_command")
    op.drop_column("tools", "config_s3_key")
    op.drop_column("tools", "source_s3_key")
    op.drop_column("tools", "one_time_price")
    op.drop_column("tools", "source_file_tree")
    op.drop_column("tools", "environment_variables")
