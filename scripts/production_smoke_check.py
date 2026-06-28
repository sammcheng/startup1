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
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


DEFAULT_FRONTEND_PATHS = [
    "/",
    "/marketplace",
    "/pricing",
    "/docs",
    "/support",
    "/terms",
    "/privacy",
    "/seller-agreement",
    "/sign-in",
    "/sign-up",
]
AUTH_BOUNDARY_PATHS = ["/dashboard", "/admin", "/approver"]
API_AUTH_BOUNDARY_PATHS = ["v1/dashboard", "v1/api-keys", "v1/seller/dashboard"]
DEFAULT_TIMEOUT_SECONDS = 15


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


NO_REDIRECT_OPENER = build_opener(NoRedirectHandler)


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
    follow_redirects: bool = True,
) -> tuple[int, str, dict[str, str]]:
    request_headers = {"User-Agent": "hackmarket-smoke-check/1.0"}
    if headers:
        request_headers.update(headers)
    req = Request(url, data=body, headers=request_headers, method=method)
    opener = urlopen if follow_redirects else NO_REDIRECT_OPENER.open
    with opener(req, timeout=timeout) as response:
        return response.status, response.read(4096).decode("utf-8", errors="replace"), dict(response.headers)


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
        status, response_body, _response_headers = request(method, url, headers=headers, body=body, timeout=timeout)
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
        status, body, _headers = request("GET", url, timeout=timeout)
    except Exception as exc:
        return CheckResult("api /ready", False, f"request failed: {exc}")

    try:
        payload: dict[str, Any] = json.loads(body)
    except json.JSONDecodeError:
        return CheckResult("api /ready", False, f"non-JSON response {status}: {body[:240]}")

    readiness = payload.get("status")
    if status == 200 and readiness == "ready":
        queue = payload.get("queue") or {}
        queue_depth = queue.get("depth")
        worker_heartbeat = queue.get("worker_heartbeat")
        if queue and worker_heartbeat is not True:
            return CheckResult("api /ready", False, f"worker heartbeat missing; payload={payload}")
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


def check_api_cors(api_root: str, app_root: str, timeout: int) -> CheckResult:
    origin = app_root.rstrip("/")
    try:
        status, body, headers = request(
            "OPTIONS",
            urljoin(api_root, "v1/tools/discover"),
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=timeout,
        )
    except Exception as exc:
        return CheckResult("api CORS production origin", False, f"request failed: {exc}")

    normalized = {key.lower(): value for key, value in headers.items()}
    allowed_origin = normalized.get("access-control-allow-origin")
    if status != 200:
        return CheckResult("api CORS production origin", False, f"unexpected {status}: {body[:240]}")
    if allowed_origin != origin:
        return CheckResult(
            "api CORS production origin",
            False,
            f"expected allow-origin {origin!r}, got {allowed_origin!r}",
        )
    return CheckResult("api CORS production origin", True, f"allows {origin}")


def parse_json_error(status: int, body: str, headers: dict[str, str]) -> str | None:
    try:
        payload: dict[str, Any] = json.loads(body)
    except json.JSONDecodeError:
        return f"non-JSON response {status}: {body[:240]}"

    error = payload.get("error")
    if not isinstance(error, dict):
        return f"missing error object in payload={payload}"

    request_id = error.get("request_id")
    header_request_id = headers.get("X-HackMarket-Request-Id") or headers.get("x-hackmarket-request-id")
    if not request_id:
        return f"missing error.request_id in payload={payload}"
    if header_request_id and request_id != header_request_id:
        return f"request id mismatch body={request_id!r} header={header_request_id!r}"
    if not error.get("code") or not error.get("message"):
        return f"missing stable code/message in payload={payload}"
    return None


def check_api_auth_boundary(api_root: str, path: str, timeout: int) -> CheckResult:
    name = f"api auth boundary /{path}"
    try:
        status, body, headers = request("GET", urljoin(api_root, path), timeout=timeout)
    except HTTPError as exc:
        status = exc.code
        body = exc.read(4096).decode("utf-8", errors="replace")
        headers = dict(exc.headers)
    except Exception as exc:
        return CheckResult(name, False, f"request failed: {exc}")

    if status not in {401, 403}:
        return CheckResult(name, False, f"unexpected public status {status}: {body[:240]}")

    error = parse_json_error(status, body, headers)
    if error:
        return CheckResult(name, False, error)
    return CheckResult(name, True, f"protected with structured {status}")


def check_frontend_security_headers(app_root: str, timeout: int) -> CheckResult:
    required = {
        "content-security-policy",
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
    }
    try:
        status, _body, headers = request("GET", app_root, timeout=timeout)
    except Exception as exc:
        return CheckResult("frontend security headers", False, f"request failed: {exc}")
    normalized = {key.lower(): value for key, value in headers.items()}
    missing = sorted(required - set(normalized))
    if status != 200:
        return CheckResult("frontend security headers", False, f"unexpected {status}")
    if missing:
        return CheckResult("frontend security headers", False, f"missing {', '.join(missing)}")
    return CheckResult("frontend security headers", True, "required headers present")


def check_api_security_headers(api_root: str, timeout: int) -> CheckResult:
    required = {
        "x-hackmarket-request-id",
        "x-hackmarket-response-time-ms",
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
    }
    try:
        status, body, headers = request("GET", urljoin(api_root, "health"), timeout=timeout)
    except Exception as exc:
        return CheckResult("api security headers", False, f"request failed: {exc}")
    normalized = {key.lower(): value for key, value in headers.items()}
    missing = sorted(required - set(normalized))
    if status != 200:
        return CheckResult("api security headers", False, f"unexpected {status}: {body[:240]}")
    if missing:
        return CheckResult("api security headers", False, f"missing {', '.join(missing)}")
    return CheckResult("api security headers", True, "required headers present")


def check_auth_boundary(app_root: str, path: str, timeout: int) -> CheckResult:
    try:
        status, _body, headers = request(
            "GET",
            urljoin(app_root, path.lstrip("/")),
            timeout=timeout,
            follow_redirects=False,
        )
    except HTTPError as exc:
        location = exc.headers.get("Location", "")
        if exc.code in {307, 308} and ("/sign-in" in location or "/sign-up" in location):
            return CheckResult(f"auth boundary {path}", True, f"redirects to auth ({exc.code})")
        if exc.code in {401, 403}:
            return CheckResult(f"auth boundary {path}", True, f"protected with {exc.code}")
        return CheckResult(f"auth boundary {path}", False, f"HTTP {exc.code}")
    except Exception as exc:
        return CheckResult(f"auth boundary {path}", False, f"request failed: {exc}")

    location = headers.get("Location", "")
    if status in {307, 308} and ("/sign-in" in location or "/sign-up" in location):
        return CheckResult(f"auth boundary {path}", True, f"redirects to auth ({status})")
    if status in {401, 403}:
        return CheckResult(f"auth boundary {path}", True, f"protected with {status}")
    return CheckResult(f"auth boundary {path}", False, f"unexpected public status {status}")


def check_submission_status_page(app_root: str, timeout: int) -> CheckResult:
    placeholder_id = "00000000-0000-4000-8000-000000000000"
    return run_http_check(
        "frontend submission status page",
        "GET",
        urljoin(app_root, f"submit/{placeholder_id}/status"),
        expected_statuses={200, 404},
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
    results.append(check_submission_status_page(app_root, args.timeout))
    results.append(check_frontend_security_headers(app_root, args.timeout))

    for path in AUTH_BOUNDARY_PATHS:
        results.append(check_auth_boundary(app_root, path, args.timeout))

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
    results.append(check_api_security_headers(api_root, args.timeout))
    results.append(check_api_cors(api_root, app_root, args.timeout))
    results.append(check_discovery(api_root, args.timeout))
    for path in API_AUTH_BOUNDARY_PATHS:
        results.append(check_api_auth_boundary(api_root, path, args.timeout))

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
