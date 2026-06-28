#!/usr/bin/env python3
"""Validate Alembic migration health for production deploys."""

from __future__ import annotations

import argparse
import ipaddress
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "apps" / "api"


ALEMBIC_ENTRYPOINT = "from alembic.config import main; main()"
SAFE_DATABASE_NAME_MARKERS = ("test", "testing", "ci", "tmp", "temp", "disposable", "scratch")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def run_alembic(args: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", ALEMBIC_ENTRYPOINT, *args],
        cwd=API_DIR,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def fail(message: str, output: str = "") -> int:
    print(f"Migration check failed: {message}", file=sys.stderr)
    if output:
        print(output, file=sys.stderr)
    return 1


def database_url_from_env(env: dict[str, str]) -> str | None:
    return env.get("MIGRATION_TEST_DATABASE_URL") or env.get("DATABASE_URL")


def database_name(database_url: str) -> str:
    parsed = urlparse(database_url)
    return parsed.path.rsplit("/", 1)[-1]


def is_local_database_host(database_url: str) -> bool:
    parsed = urlparse(database_url)
    host = parsed.hostname
    if not host:
        return False
    if host.lower() in LOCAL_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def has_safe_database_name(database_url: str) -> bool:
    name = database_name(database_url).lower()
    return any(marker in name for marker in SAFE_DATABASE_NAME_MARKERS)


def validate_database_target(args: argparse.Namespace, env: dict[str, str]) -> int:
    database_url = database_url_from_env(env)
    if not database_url:
        return fail("DATABASE_URL or MIGRATION_TEST_DATABASE_URL must be set")

    if env.get("ENVIRONMENT") == "production" and not args.allow_production_env:
        return fail("refusing to run migration validation with ENVIRONMENT=production")

    if not is_local_database_host(database_url) and not args.allow_remote_database:
        return fail(
            "refusing to run migration validation against a remote database; "
            "use --allow-remote-database only for a disposable non-production database"
        )

    if not has_safe_database_name(database_url) and not args.allow_any_database_name:
        return fail(
            "refusing to run migration validation against a database name that does not look disposable; "
            "use a name containing test, ci, temp, disposable, or scratch"
        )

    env["DATABASE_URL"] = database_url
    return 0


def check_single_head(env: dict[str, str]) -> int:
    result = run_alembic(["heads"], env=env)
    if result.returncode != 0:
        return fail("could not inspect Alembic heads", result.stdout)

    heads = [line for line in result.stdout.splitlines() if line.strip()]
    if len(heads) != 1:
        return fail(f"expected exactly one Alembic head, found {len(heads)}", result.stdout)

    print(f"Single Alembic head detected: {heads[0]}")
    return 0


def check_upgrade_head(env: dict[str, str]) -> int:
    result = run_alembic(["upgrade", "head"], env=env)
    if result.returncode != 0:
        return fail("alembic upgrade head failed", result.stdout)

    current = run_alembic(["current"], env=env)
    if current.returncode != 0:
        return fail("could not inspect current Alembic revision after upgrade", current.stdout)

    if "(head)" not in current.stdout:
        return fail("database did not end at Alembic head after upgrade", current.stdout)

    print("Alembic upgrade head succeeded.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--upgrade",
        action="store_true",
        help="Run alembic upgrade head against DATABASE_URL after checking migration heads.",
    )
    parser.add_argument(
        "--allow-remote-database",
        action="store_true",
        help="Allow a non-local database host. Use only with disposable staging/test databases.",
    )
    parser.add_argument(
        "--allow-any-database-name",
        action="store_true",
        help="Allow a database name without a test/ci/temp/disposable marker.",
    )
    parser.add_argument(
        "--allow-production-env",
        action="store_true",
        help="Allow ENVIRONMENT=production. This should almost never be used for this validation script.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    env = os.environ.copy()
    env.setdefault("ENVIRONMENT", "test")
    env.setdefault("REDIS_URL", "redis://localhost:6379/15")
    env.setdefault("STRIPE_SECRET_KEY", "sk_test_migration_check")
    env.setdefault("CLERK_JWKS_URL", "https://example.com/.well-known/jwks.json")

    target_status = validate_database_target(args, env)
    if target_status:
        return target_status

    head_status = check_single_head(env)
    if head_status:
        return head_status

    if args.upgrade:
        return check_upgrade_head(env)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
