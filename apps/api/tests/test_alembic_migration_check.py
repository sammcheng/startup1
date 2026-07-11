import importlib.util
import os
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "check_alembic_migrations.py"
SPEC = importlib.util.spec_from_file_location("check_alembic_migrations", SCRIPT_PATH)
assert SPEC and SPEC.loader
checker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checker
SPEC.loader.exec_module(checker)


def test_local_test_database_target_is_allowed():
    args = checker.build_parser().parse_args([])
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_test",
        "ENVIRONMENT": "test",
    }

    assert checker.validate_database_target(args, env) == 0


def test_migration_test_database_url_overrides_database_url():
    args = checker.build_parser().parse_args([])
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_prod",
        "MIGRATION_TEST_DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_ci",
        "ENVIRONMENT": "test",
    }

    assert checker.validate_database_target(args, env) == 0
    assert env["DATABASE_URL"].endswith("/hackmarket_ci")


def test_remote_database_target_is_blocked_by_default():
    args = checker.build_parser().parse_args([])
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@db.example.com:5432/hackmarket_test",
        "ENVIRONMENT": "test",
    }

    assert checker.validate_database_target(args, env) == 1


def test_non_disposable_database_name_is_blocked_by_default():
    args = checker.build_parser().parse_args([])
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket",
        "ENVIRONMENT": "test",
    }

    assert checker.validate_database_target(args, env) == 1


def test_production_environment_is_blocked_by_default():
    args = checker.build_parser().parse_args([])
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_test",
        "ENVIRONMENT": "production",
    }

    assert checker.validate_database_target(args, env) == 1


def test_override_flags_allow_explicit_disposable_remote_target():
    args = checker.build_parser().parse_args(
        ["--allow-remote-database", "--allow-any-database-name", "--allow-production-env"]
    )
    env = {
        "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@db.example.com:5432/hackmarket",
        "ENVIRONMENT": "production",
    }

    assert checker.validate_database_target(args, env) == 0


def test_main_uses_validation_before_running_alembic(monkeypatch):
    called = False

    def fake_check_single_head(env):
        nonlocal called
        called = True
        return 0

    monkeypatch.setattr(checker, "check_single_head", fake_check_single_head)
    monkeypatch.setattr(
        os,
        "environ",
        {
            "DATABASE_URL": "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket",
            "ENVIRONMENT": "test",
        },
    )

    assert checker.main([]) == 1
    assert called is False
