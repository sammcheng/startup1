#!/usr/bin/env python3
"""Fail when generated or local-only files are committed.

This guard is intentionally based on `git ls-files`, not the working tree, so
developers can freely have local build outputs while CI protects repository
history from cache folders, dependencies, and private env files.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_PATH_PARTS = {
    ".mypy_cache",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".turbo",
    ".vercel",
    "__pycache__",
    "coverage",
    "node_modules",
}

FORBIDDEN_FILENAMES = {
    ".DS_Store",
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.production",
    ".env.production.local",
    ".env.test.local",
}

FORBIDDEN_SUFFIXES = {
    ".log",
    ".pyc",
    ".pyo",
    ".tsbuildinfo",
}


def tracked_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [Path(path.decode("utf-8")) for path in result.stdout.split(b"\0") if path]


def hygiene_violations(paths: list[Path]) -> list[str]:
    violations: list[str] = []
    for path in paths:
        if any(part in FORBIDDEN_PATH_PARTS for part in path.parts):
            violations.append(f"{path}: generated/cache/dependency path is tracked")
            continue
        if path.name in FORBIDDEN_FILENAMES:
            violations.append(f"{path}: local environment file is tracked")
            continue
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            violations.append(f"{path}: generated file extension is tracked")
    return violations


def main() -> int:
    violations = hygiene_violations(tracked_paths())
    if violations:
        print("Repository hygiene check failed. Remove these tracked local/generated files:")
        for violation in violations:
            print(f"- {violation}")
        return 1

    print("Repository hygiene check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
