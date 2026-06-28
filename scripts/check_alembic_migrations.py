#!/usr/bin/env python3
"""Validate Alembic migration health for production deploys."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "apps" / "api"


ALEMBIC_ENTRYPOINT = "from alembic.config import main; main()"


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
    return parser


def main() -> int:
    args = build_parser().parse_args()
    env = os.environ.copy()
    env.setdefault("ENVIRONMENT", "test")
    env.setdefault("REDIS_URL", "redis://localhost:6379/15")
    env.setdefault("STRIPE_SECRET_KEY", "sk_test_migration_check")
    env.setdefault("CLERK_JWKS_URL", "https://example.com/.well-known/jwks.json")

    if "DATABASE_URL" not in env:
        return fail("DATABASE_URL must be set")

    head_status = check_single_head(env)
    if head_status:
        return head_status

    if args.upgrade:
        return check_upgrade_head(env)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
