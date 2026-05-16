"""add user stripe fields

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-29 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("stripe_connect_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "stripe_connect_id")
    op.drop_column("users", "stripe_customer_id")
