import importlib.util
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "check_migration_safety.py"
SPEC = importlib.util.spec_from_file_location("check_migration_safety", SCRIPT_PATH)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


def write_migration(tmp_path, source: str) -> Path:
    path = tmp_path / "0009_test_migration.py"
    path.write_text(source, encoding="utf-8")
    return path


def test_migration_safety_flags_destructive_upgrade(tmp_path):
    path = write_migration(
        tmp_path,
        """
from alembic import op

def upgrade():
    op.drop_column("users", "legacy_field")

def downgrade():
    pass
""",
    )

    findings = checker.inspect_migration(path)

    assert len(findings) == 1
    assert "drop_column" in findings[0].message


def test_migration_safety_ignores_downgrade_cleanup(tmp_path):
    path = write_migration(
        tmp_path,
        """
from alembic import op

def upgrade():
    op.add_column("users", "safe_column")

def downgrade():
    op.drop_column("users", "safe_column")
""",
    )

    assert checker.inspect_migration(path) == []


def test_migration_safety_review_marker_allows_risky_upgrade(tmp_path):
    path = write_migration(
        tmp_path,
        """
MIGRATION_SAFETY_REVIEWED = True
from alembic import op

def upgrade():
    op.drop_table("legacy_events")
""",
    )

    assert checker.inspect_migration(path) == []


def test_migration_safety_flags_raw_destructive_sql(tmp_path):
    path = write_migration(
        tmp_path,
        """
import sqlalchemy as sa
from alembic import op

def upgrade():
    op.execute(sa.text("delete from usage_logs where created_at < now()"))
""",
    )

    findings = checker.inspect_migration(path)

    assert len(findings) == 1
    assert "destructive SQL" in findings[0].message
