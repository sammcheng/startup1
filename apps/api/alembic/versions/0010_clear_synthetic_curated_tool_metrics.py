"""Clear synthetic curated-tool metrics

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            update tools
            set
                avg_response_time_ms = case
                    when avg_response_time_ms = 420 then null
                    else avg_response_time_ms
                end,
                uptime_percentage = case
                    when uptime_percentage = 99.90 then null
                    else uptime_percentage
                end
            where slug = 'home-accessibility-checker'
              and seller_id in (
                  select id
                  from users
                  where clerk_id = 'system_curated_seller'
              )
              and (
                  avg_response_time_ms = 420
                  or uptime_percentage = 99.90
              )
            """
        )
    )


def downgrade() -> None:
    # Synthetic telemetry must not be recreated during a rollback.
    pass
