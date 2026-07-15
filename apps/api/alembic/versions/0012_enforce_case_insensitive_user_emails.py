"""Enforce normalized, case-insensitive user email uniqueness

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _assert_no_case_insensitive_duplicates() -> None:
    duplicate = (
        op.get_bind()
        .execute(
            sa.text(
                """
                select lower(trim(email)) as normalized_email
                from users
                group by lower(trim(email))
                having count(*) > 1
                limit 1
                """
            )
        )
        .first()
    )
    if duplicate:
        raise RuntimeError(
            "Cannot enforce case-insensitive user emails while duplicate addresses exist."
        )


def upgrade() -> None:
    _assert_no_case_insensitive_duplicates()
    op.execute(sa.text("update users set email = lower(trim(email))"))
    op.create_index(
        "ux_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_users_email_lower", table_name="users")
