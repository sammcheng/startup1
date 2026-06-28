import importlib.util
import sys
from pathlib import Path
from urllib.error import HTTPError


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "production_smoke_check.py"
SPEC = importlib.util.spec_from_file_location("production_smoke_check", SCRIPT_PATH)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = smoke
SPEC.loader.exec_module(smoke)


def test_parse_json_error_requires_request_id_match():
    body = '{"error":{"code":"unauthorized","message":"Authorization header required.","request_id":"req_1"}}'

    assert smoke.parse_json_error(401, body, {"X-HackMarket-Request-Id": "req_1"}) is None
    assert (
        smoke.parse_json_error(401, body, {"X-HackMarket-Request-Id": "req_2"})
        == "request id mismatch body='req_1' header='req_2'"
    )


def test_api_auth_boundary_requires_structured_json_error(monkeypatch):
    class FakeHeaders(dict):
        def get(self, key, default=None):
            return super().get(key, default)

    class FakeHTTPError(HTTPError):
        def __init__(self):
            super().__init__(
                "https://api.example.com/v1/dashboard",
                401,
                "Unauthorized",
                FakeHeaders({"X-HackMarket-Request-Id": "req_123"}),
                None,
            )

        def read(self, amt=None):
            return b'{"error":{"code":"unauthorized","message":"Authorization header required.","request_id":"req_123"}}'

    def fake_request(*args, **kwargs):
        raise FakeHTTPError()

    monkeypatch.setattr(smoke, "request", fake_request)

    result = smoke.check_api_auth_boundary("https://api.example.com/", "v1/dashboard", 5)

    assert result.ok is True
    assert result.detail == "protected with structured 401"


def test_api_cors_requires_exact_production_origin(monkeypatch):
    def fake_request(*args, **kwargs):
        return 200, "", {"Access-Control-Allow-Origin": "https://hackmarket.io"}

    monkeypatch.setattr(smoke, "request", fake_request)

    result = smoke.check_api_cors("https://api.example.com/", "https://hackmarket.io/", 5)

    assert result.ok is True
    assert result.detail == "allows https://hackmarket.io"


def test_admin_operations_health_smoke_requires_expected_sections(monkeypatch):
    body = """
    {
      "status": "healthy",
      "checks": {"queue": "ok", "worker": "ok", "processing_jobs": "ok"},
      "queue": {"depth": 0, "worker_heartbeat": true},
      "processing_jobs": {"stuck_active": 0, "failed_recent": 0}
    }
    """

    def fake_request(*args, **kwargs):
        assert kwargs["headers"] == {"Authorization": "Bearer admin-token"}
        return 200, body, {}

    monkeypatch.setattr(smoke, "request", fake_request)

    result = smoke.check_admin_operations_health("https://api.example.com/", "admin-token", 5)

    assert result.ok is True
    assert result.detail.startswith("healthy; checks=")


def test_admin_operations_health_smoke_rejects_incomplete_payload(monkeypatch):
    def fake_request(*args, **kwargs):
        return 200, '{"status":"healthy","checks":{}}', {}

    monkeypatch.setattr(smoke, "request", fake_request)

    result = smoke.check_admin_operations_health("https://api.example.com/", "admin-token", 5)

    assert result.ok is False
    assert "missing operations health sections" in result.detail


def test_admin_operations_health_is_part_of_api_auth_boundaries():
    assert "v1/admin/operations-health" in smoke.API_AUTH_BOUNDARY_PATHS
    assert "v1/admin/audit-logs" in smoke.API_AUTH_BOUNDARY_PATHS
