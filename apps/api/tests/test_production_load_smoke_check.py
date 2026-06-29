import argparse
import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "production_load_smoke_check.py"
SPEC = importlib.util.spec_from_file_location("production_load_smoke_check", SCRIPT_PATH)
assert SPEC and SPEC.loader
load_smoke = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = load_smoke
SPEC.loader.exec_module(load_smoke)


def test_build_targets_includes_public_checks_by_default():
    args = argparse.Namespace(
        api_url="https://api.example.com",
        discovery_query="accessibility",
        discovery_limit=3,
        gateway_tool_slug=None,
        gateway_api_key=None,
        gateway_body='{"text":"launch smoke"}',
    )

    targets = load_smoke.build_targets(args)

    assert [target.name for target in targets] == ["api readiness", "public discovery"]
    assert targets[0].url == "https://api.example.com/ready"
    assert targets[1].url == "https://api.example.com/v1/tools/discover"


def test_build_targets_adds_gateway_when_credentials_are_available():
    args = argparse.Namespace(
        api_url="https://api.example.com",
        discovery_query="accessibility",
        discovery_limit=3,
        gateway_tool_slug="home-accessibility-checker",
        gateway_api_key="hm_live_test",
        gateway_body='{"text":"launch smoke"}',
    )

    targets = load_smoke.build_targets(args)

    gateway = targets[2]
    assert gateway.name == "gateway invocation"
    assert gateway.url == "https://api.example.com/api/v1/tools/home-accessibility-checker"
    assert gateway.headers["X-API-Key"] == "hm_live_test"


def test_build_targets_normalizes_versioned_api_url():
    args = argparse.Namespace(
        api_url="https://api.example.com/v1",
        discovery_query="accessibility",
        discovery_limit=3,
        gateway_tool_slug="home-accessibility-checker",
        gateway_api_key="hm_live_test",
        gateway_body='{"text":"launch smoke"}',
    )

    targets = load_smoke.build_targets(args)

    assert targets[0].url == "https://api.example.com/ready"
    assert targets[1].url == "https://api.example.com/v1/tools/discover"
    assert targets[2].url == "https://api.example.com/api/v1/tools/home-accessibility-checker"


def test_build_targets_normalizes_gateway_api_url():
    args = argparse.Namespace(
        api_url="https://api.example.com/api/v1",
        discovery_query="accessibility",
        discovery_limit=3,
        gateway_tool_slug="home-accessibility-checker",
        gateway_api_key="hm_live_test",
        gateway_body='{"text":"launch smoke"}',
    )

    targets = load_smoke.build_targets(args)

    assert targets[0].url == "https://api.example.com/ready"
    assert targets[1].url == "https://api.example.com/v1/tools/discover"
    assert targets[2].url == "https://api.example.com/api/v1/tools/home-accessibility-checker"


def test_summarize_results_fails_when_latency_exceeds_threshold():
    results = [
        load_smoke.RequestResult("public discovery", True, 200, 100, "HTTP 200"),
        load_smoke.RequestResult("public discovery", True, 200, 3000, "HTTP 200"),
    ]

    summary = load_smoke.summarize_results(
        "public discovery",
        results,
        max_error_rate=0,
        max_p95_ms=1000,
        max_ms=5000,
    )

    assert summary.passed is False
    assert summary.failures == 0
    assert summary.p95_ms == 3000


def test_run_target_collects_failures_and_error_rate():
    target = load_smoke.RequestTarget("api readiness", "GET", "https://api.example.com/ready", {200}, {}, None)
    calls = 0

    def fake_requester(current_target, timeout):
        nonlocal calls
        calls += 1
        assert current_target is target
        assert timeout == 5
        if calls == 1:
            return load_smoke.RequestResult("api readiness", False, 500, 25, "HTTP 500")
        return load_smoke.RequestResult("api readiness", True, 200, 20, "HTTP 200")

    summary, results = load_smoke.run_target(
        target,
        requests=4,
        concurrency=2,
        timeout=5,
        max_error_rate=0.2,
        max_p95_ms=1000,
        max_ms=5000,
        requester=fake_requester,
    )

    assert len(results) == 4
    assert summary.failures == 1
    assert summary.error_rate == 0.25
    assert summary.passed is False
