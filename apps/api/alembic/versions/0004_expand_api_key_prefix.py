"""expand api key prefix length

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-29 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("api_keys", "key_prefix", existing_type=sa.String(length=8), type_=sa.String(length=16))


def downgrade() -> None:
    op.alter_column("api_keys", "key_prefix", existing_type=sa.String(length=16), type_=sa.String(length=8))
