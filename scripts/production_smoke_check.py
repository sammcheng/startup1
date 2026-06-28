#!/usr/bin/env python3
"""Smoke-test a live Hackmarket deployment.

This script intentionally supports unauthenticated checks by default so it can
run from CI or a laptop without secrets. Authenticated checks are opt-in through
tokens passed as environment variables.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_FRONTEND_PATHS = ["/", "/marketplace", "/docs", "/admin", "/approver", "/sign-in", "/sign-up"]
DEFAULT_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


def normalize_base_url(url: str) -> str:
    return url.rstrip("/") + "/"


def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[int, str]:
    request_headers = {"User-Agent": "hackmarket-smoke-check/1.0"}
    if headers:
        request_headers.update(headers)
    req = Request(url, data=body, headers=request_headers, method=method)
    with urlopen(req, timeout=timeout) as response:
        return response.status, response.read(4096).decode("utf-8", errors="replace")


def run_http_check(
    name: str,
    method: str,
    url: str,
    *,
    expected_statuses: set[int],
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int,
) -> CheckResult:
    started = time.perf_counter()
    try:
        status, response_body = request(method, url, headers=headers, body=body, timeout=timeout)
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        if status in expected_statuses:
            return CheckResult(name, True, f"{status} in {elapsed_ms}ms")
        return CheckResult(name, False, f"unexpected {status}: {response_body[:240]}")
    except HTTPError as exc:
        body_text = exc.read(4096).decode("utf-8", errors="replace")
        if exc.code in expected_statuses:
            return CheckResult(name, True, f"{exc.code} in {round((time.perf_counter() - started) * 1000)}ms")
        return CheckResult(name, False, f"HTTP {exc.code}: {body_text[:240]}")
    except URLError as exc:
        return CheckResult(name, False, f"network error: {exc.reason}")
    except TimeoutError:
        return CheckResult(name, False, f"timed out after {timeout}s")


def check_ready(api_root: str, timeout: int) -> CheckResult:
    url = urljoin(api_root, "ready")
    try:
        status, body = request("GET", url, timeout=timeout)
    except Exception as exc:
        return CheckResult("api /ready", False, f"request failed: {exc}")

    try:
        payload: dict[str, Any] = json.loads(body)
    except json.JSONDecodeError:
        return CheckResult("api /ready", False, f"non-JSON response {status}: {body[:240]}")

    readiness = payload.get("status")
    if status == 200 and readiness == "ready":
        queue_depth = payload.get("queue", {}).get("depth")
        return CheckResult("api /ready", True, f"ready; queue_depth={queue_depth}")
    return CheckResult("api /ready", False, f"{status}; payload={payload}")


def check_discovery(api_root: str, timeout: int) -> CheckResult:
    body = json.dumps({"query": "accessibility", "limit": 3}).encode("utf-8")
    return run_http_check(
        "public tool discovery",
        "POST",
        urljoin(api_root, "v1/tools/discover"),
        expected_statuses={200},
        headers={"Content-Type": "application/json"},
        body=body,
        timeout=timeout,
    )


def check_authenticated_dashboard(app_root: str, clerk_session_token: str, timeout: int) -> CheckResult:
    return run_http_check(
        "signed-in dashboard",
        "GET",
        urljoin(app_root, "dashboard"),
        expected_statuses={200, 307, 308},
        headers={"Authorization": f"Bearer {clerk_session_token}"},
        timeout=timeout,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", default=os.getenv("APP_BASE_URL"), help="Frontend base URL")
    parser.add_argument("--api-url", default=os.getenv("PUBLIC_API_BASE_URL"), help="API root URL without /v1")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--clerk-session-token",
        default=os.getenv("CLERK_SESSION_TOKEN"),
        help="Optional Clerk session token for signed-in smoke checks",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.app_url or not args.api_url:
        print("Provide --app-url and --api-url, or set APP_BASE_URL and PUBLIC_API_BASE_URL.")
        return 2

    app_root = normalize_base_url(args.app_url)
    api_root = normalize_base_url(args.api_url)
    results: list[CheckResult] = []

    for path in DEFAULT_FRONTEND_PATHS:
        results.append(
            run_http_check(
                f"frontend {path}",
                "GET",
                urljoin(app_root, path.lstrip("/")),
                expected_statuses={200, 307, 308},
                timeout=args.timeout,
            )
        )

    results.append(
        run_http_check(
            "api /health",
            "GET",
            urljoin(api_root, "health"),
            expected_statuses={200},
            timeout=args.timeout,
        )
    )
    results.append(check_ready(api_root, args.timeout))
    results.append(check_discovery(api_root, args.timeout))

    if args.clerk_session_token:
        results.append(check_authenticated_dashboard(app_root, args.clerk_session_token, args.timeout))

    failed = [result for result in results if not result.ok]
    for result in results:
        status = "PASS" if result.ok else "FAIL"
        print(f"[{status}] {result.name}: {result.detail}")

    if failed:
        print(f"\n{len(failed)} smoke check(s) failed.")
        return 1

    print("\nProduction smoke checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
