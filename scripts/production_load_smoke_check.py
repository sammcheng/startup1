#!/usr/bin/env python3
"""Run a small launch-readiness load smoke against a live deployment.

This is not a replacement for a full load test. It is a fast production/staging
gate that catches obvious latency spikes, error bursts, and gateway regressions
before inviting real users.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

DEFAULT_TIMEOUT_SECONDS = 15
DEFAULT_REQUESTS = 40
DEFAULT_CONCURRENCY = 8
DEFAULT_MAX_ERROR_RATE = 0.02
DEFAULT_P95_MS = 1500
DEFAULT_MAX_MS = 5000


@dataclass(frozen=True)
class RequestTarget:
    name: str
    method: str
    url: str
    expected_statuses: set[int]
    headers: dict[str, str]
    body: bytes | None


@dataclass(frozen=True)
class RequestResult:
    target: str
    ok: bool
    status: int | None
    elapsed_ms: float
    detail: str


@dataclass(frozen=True)
class TargetSummary:
    name: str
    total: int
    failures: int
    error_rate: float
    p95_ms: float
    max_ms: float
    passed: bool


def normalize_base_url(url: str) -> str:
    return url.rstrip("/") + "/"


def api_origin_url(url: str) -> str:
    normalized = normalize_base_url(url)
    if normalized.endswith("/api/v1/"):
        return normalized[: -len("api/v1/")]
    if normalized.endswith("/v1/"):
        return normalized[: -len("v1/")]
    return normalized


def rest_api_url(url: str, path: str) -> str:
    return urljoin(api_origin_url(url), f"v1/{path.lstrip('/')}")


def gateway_api_url(url: str, path: str) -> str:
    return urljoin(api_origin_url(url), f"api/v1/{path.lstrip('/')}")


def percentile(values: list[float], percentile_value: float) -> float:
    if not values:
        return 0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = round((len(ordered) - 1) * percentile_value)
    return ordered[index]


def perform_request(target: RequestTarget, timeout: int) -> RequestResult:
    started = time.perf_counter()
    req = Request(target.url, data=target.body, headers=target.headers, method=target.method)
    try:
        with urlopen(req, timeout=timeout) as response:
            response.read(4096)
            elapsed_ms = (time.perf_counter() - started) * 1000
            ok = response.status in target.expected_statuses
            return RequestResult(
                target.name, ok, response.status, elapsed_ms, f"HTTP {response.status}"
            )
    except HTTPError as exc:
        exc.read(4096)
        elapsed_ms = (time.perf_counter() - started) * 1000
        ok = exc.code in target.expected_statuses
        return RequestResult(target.name, ok, exc.code, elapsed_ms, f"HTTP {exc.code}")
    except TimeoutError:
        return RequestResult(
            target.name, False, None, timeout * 1000, f"timed out after {timeout}s"
        )
    except URLError as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return RequestResult(target.name, False, None, elapsed_ms, f"network error: {exc.reason}")


def summarize_results(
    name: str,
    results: list[RequestResult],
    *,
    max_error_rate: float,
    max_p95_ms: int,
    max_ms: int,
) -> TargetSummary:
    latencies = [result.elapsed_ms for result in results]
    failures = sum(1 for result in results if not result.ok)
    total = len(results)
    error_rate = failures / total if total else 1
    p95_ms = percentile(latencies, 0.95)
    highest_ms = max(latencies, default=0)
    passed = error_rate <= max_error_rate and p95_ms <= max_p95_ms and highest_ms <= max_ms
    return TargetSummary(name, total, failures, error_rate, p95_ms, highest_ms, passed)


def run_target(
    target: RequestTarget,
    *,
    requests: int,
    concurrency: int,
    timeout: int,
    max_error_rate: float,
    max_p95_ms: int,
    max_ms: int,
    requester: Callable[[RequestTarget, int], RequestResult] = perform_request,
) -> tuple[TargetSummary, list[RequestResult]]:
    results: list[RequestResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(requester, target, timeout) for _ in range(requests)]
        for future in as_completed(futures):
            results.append(future.result())

    summary = summarize_results(
        target.name,
        results,
        max_error_rate=max_error_rate,
        max_p95_ms=max_p95_ms,
        max_ms=max_ms,
    )
    return summary, results


def build_targets(args: argparse.Namespace) -> list[RequestTarget]:
    api_root = api_origin_url(args.api_url)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "hackmarket-load-smoke/1.0",
    }
    targets = [
        RequestTarget(
            "api readiness",
            "GET",
            urljoin(api_root, "ready"),
            {200},
            {"User-Agent": headers["User-Agent"]},
            None,
        ),
        RequestTarget(
            "public discovery",
            "POST",
            rest_api_url(args.api_url, "tools/discover"),
            {200},
            headers,
            json.dumps({"query": args.discovery_query, "limit": args.discovery_limit}).encode(
                "utf-8"
            ),
        ),
    ]
    if args.gateway_tool_slug and args.gateway_api_key:
        gateway_headers = {**headers, "X-API-Key": args.gateway_api_key}
        targets.append(
            RequestTarget(
                "gateway invocation",
                "POST",
                gateway_api_url(args.api_url, f"tools/{args.gateway_tool_slug}"),
                {200},
                gateway_headers,
                args.gateway_body.encode("utf-8"),
            )
        )
    return targets


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-url",
        default=os.getenv("PUBLIC_API_BASE_URL"),
        help="API origin URL; /v1 or /api/v1 suffixes are normalized automatically",
    )
    parser.add_argument("--requests", type=int, default=DEFAULT_REQUESTS)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--max-error-rate", type=float, default=DEFAULT_MAX_ERROR_RATE)
    parser.add_argument("--max-p95-ms", type=int, default=DEFAULT_P95_MS)
    parser.add_argument("--max-ms", type=int, default=DEFAULT_MAX_MS)
    parser.add_argument("--discovery-query", default="accessibility")
    parser.add_argument("--discovery-limit", type=int, default=3)
    parser.add_argument("--gateway-tool-slug", default=os.getenv("GATEWAY_TOOL_SLUG"))
    parser.add_argument("--gateway-api-key", default=os.getenv("GATEWAY_API_KEY"))
    parser.add_argument("--gateway-body", default='{"text":"launch smoke"}')
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.api_url:
        print("Provide --api-url or set PUBLIC_API_BASE_URL.", file=sys.stderr)
        return 2
    if args.requests < 1 or args.concurrency < 1:
        print("--requests and --concurrency must both be positive.", file=sys.stderr)
        return 2
    if args.concurrency > args.requests:
        args.concurrency = args.requests

    summaries: list[TargetSummary] = []
    for target in build_targets(args):
        summary, results = run_target(
            target,
            requests=args.requests,
            concurrency=args.concurrency,
            timeout=args.timeout,
            max_error_rate=args.max_error_rate,
            max_p95_ms=args.max_p95_ms,
            max_ms=args.max_ms,
        )
        summaries.append(summary)
        failed_samples = [result for result in results if not result.ok][:3]
        status = "PASS" if summary.passed else "FAIL"
        print(
            f"[{status}] {summary.name}: total={summary.total} failures={summary.failures} "
            f"error_rate={summary.error_rate:.1%} p95={summary.p95_ms:.0f}ms max={summary.max_ms:.0f}ms"
        )
        for sample in failed_samples:
            print(f"  sample failure: {sample.detail}")

    if any(not summary.passed for summary in summaries):
        print("\nProduction load smoke failed.")
        return 1

    print("\nProduction load smoke passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
