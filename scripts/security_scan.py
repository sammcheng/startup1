#!/usr/bin/env python3
"""Scan tracked repository files for committed production secrets.

The scanner is intentionally dependency-free so it can run in CI before any app
dependencies are installed. It scans only `git ls-files` output, which keeps
local developer `.env` files out of the signal while still protecting the repo.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MAX_FILE_BYTES = 2_000_000


IGNORED_PATH_PARTS = {
    ".git",
    ".next",
    ".vercel",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
}

BINARY_EXTENSIONS = {
    ".avif",
    ".eot",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".pdf",
    ".png",
    ".pyc",
    ".so",
    ".ttf",
    ".webp",
    ".woff",
    ".woff2",
    ".zip",
}

PLACEHOLDER_MARKERS = (
    "...",
    "abc123",
    "change-me",
    "changeme",
    "ci",
    "demo",
    "example",
    "fake",
    "fixture",
    "mock",
    "placeholder",
    "test",
    "value",
    "your_",
)


@dataclass(frozen=True)
class SecretPattern:
    name: str
    regex: re.Pattern[str]


PATTERNS = [
    SecretPattern("GitHub token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b")),
    SecretPattern("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,}\b")),
    SecretPattern("AWS access key id", re.compile(r"\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b")),
    SecretPattern("Stripe live secret key", re.compile(r"\bsk_live_[A-Za-z0-9]{20,}\b")),
    SecretPattern("Stripe restricted live key", re.compile(r"\brk_live_[A-Za-z0-9]{20,}\b")),
    SecretPattern("OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b")),
    SecretPattern("OpenRouter API key", re.compile(r"\bsk-or-v1-[A-Za-z0-9_-]{32,}\b")),
    SecretPattern("Clerk secret key", re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b")),
    SecretPattern("Clerk publishable live key", re.compile(r"\bpk_live_[A-Za-z0-9]{24,}\b")),
    SecretPattern("Stripe webhook secret", re.compile(r"\bwhsec_[A-Za-z0-9]{20,}\b")),
    SecretPattern(
        "sensitive env assignment",
        re.compile(
            r"(?im)^\s*(?:export\s+)?"
            r"(?:CLERK_SECRET_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|"
            r"OPENAI_API_KEY|OPENROUTER_API_KEY|AWS_SECRET_ACCESS_KEY|"
            r"RENDER_API_KEY|GHCR_TOKEN|CONVERTER_SECRET|ALERT_WEBHOOK_URL)"
            r"[^\S\r\n]*[:=][^\S\r\n]*['\"]?([^'\"\s#]+)"
        ),
    ),
]

ENV_ASSIGNMENT_FILES = {
    ".env",
    ".env.example",
    ".npmrc",
    ".pypirc",
}
ENV_ASSIGNMENT_SUFFIXES = {
    ".env",
    ".ini",
    ".toml",
    ".yaml",
    ".yml",
}


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [
        REPO_ROOT / path.decode("utf-8")
        for path in result.stdout.split(b"\0")
        if path
    ]


def should_skip(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    if any(part in IGNORED_PATH_PARTS for part in relative.parts):
        return True
    return path.suffix.lower() in BINARY_EXTENSIONS


def is_placeholder(value: str) -> bool:
    normalized = value.strip().strip("'\"").lower()
    if not normalized:
        return True
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def should_scan_env_assignments(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT)
    name = relative.name.lower()
    if name in ENV_ASSIGNMENT_FILES or name.endswith(".env.example"):
        return True
    return any(name.endswith(suffix) for suffix in ENV_ASSIGNMENT_SUFFIXES)


def line_number(content: str, offset: int) -> int:
    return content.count("\n", 0, offset) + 1


def scan_file(path: Path) -> list[str]:
    if should_skip(path) or path.stat().st_size > MAX_FILE_BYTES:
        return []

    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []

    relative = path.relative_to(REPO_ROOT)
    findings: list[str] = []
    for pattern in PATTERNS:
        if pattern.name == "sensitive env assignment" and not should_scan_env_assignments(path):
            continue
        for match in pattern.regex.finditer(content):
            candidate = match.group(1) if pattern.name == "sensitive env assignment" else match.group(0)
            if is_placeholder(candidate):
                continue
            findings.append(f"{relative}:{line_number(content, match.start())}: {pattern.name}")
    return findings


def main() -> int:
    findings: list[str] = []
    for path in tracked_files():
        findings.extend(scan_file(path))

    if findings:
        print("Security scan failed. Remove these committed secrets or replace them with placeholders:")
        for finding in findings:
            print(f"- {finding}")
        return 1

    print("Security scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
