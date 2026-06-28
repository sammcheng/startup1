"""Add production data integrity constraints

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _assert_no_duplicates(query: str, message: str) -> None:
    conn = op.get_bind()
    duplicate = conn.execute(sa.text(query)).first()
    if duplicate:
        raise RuntimeError(message)


def upgrade() -> None:
    _assert_no_duplicates(
        """
        select key_hash
        from api_keys
        group by key_hash
        having count(*) > 1
        limit 1
        """,
        "Cannot add ux_api_keys_key_hash while duplicate API key hashes exist.",
    )
    _assert_no_duplicates(
        """
        select buyer_id, tool_id
        from tool_purchases
        where status in ('pending', 'active')
        group by buyer_id, tool_id
        having count(*) > 1
        limit 1
        """,
        "Cannot add ux_tool_purchases_buyer_tool_open while duplicate open purchases exist.",
    )

    op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
    op.create_index("ux_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)
    op.create_index(
        "ux_tool_purchases_buyer_tool_open",
        "tool_purchases",
        ["buyer_id", "tool_id"],
        unique=True,
        postgresql_where=sa.text("status in ('pending', 'active')"),
    )


def downgrade() -> None:
    op.drop_index("ux_tool_purchases_buyer_tool_open", table_name="tool_purchases")
    op.drop_index("ux_api_keys_key_hash", table_name="api_keys")
    op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"])
