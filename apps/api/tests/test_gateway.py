from decimal import Decimal

import httpx
import pytest

from app.dependencies import validate_api_key
from app.exceptions import InvalidAPIKeyError
from app.main import app
from app.routers import gateway
from app.services import tool_service, usage_service


def test_valid_api_key_forwards_request(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        assert slug == live_tool.slug
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        return httpx.Response(200, json={"ok": True}, headers={"content-type": "application/json"})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)
    monkeypatch.setattr(usage_service, "create_usage_log", noop)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["X-HackMarket-Request-Id"]
    assert response.headers["X-RateLimit-Limit"] == "100"


def test_invalid_api_key_rejected(client, live_tool):
    async def invalid_key():
        raise InvalidAPIKeyError()

    app.dependency_overrides[validate_api_key] = invalid_key

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "bad-key"}, json={"text": "hello"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_api_key"


def test_inactive_api_key_rejected(client, live_tool):
    async def inactive_key():
        raise InvalidAPIKeyError("API key is invalid or inactive.")

    app.dependency_overrides[validate_api_key] = inactive_key

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "inactive"}, json={"text": "hello"})

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "API key is invalid or inactive."


def test_rate_limit_enforced(client, auth_overrides, buyer, api_key, live_tool, fake_redis, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))
    fake_redis.values[f"ratelimit:{api_key.id}"] = 100

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limit_exceeded"
    assert response.headers["X-RateLimit-Limit"] == "100"
    assert response.headers["X-RateLimit-Remaining"] == "0"
    assert response.headers["Retry-After"] == "60"


def test_rate_limit_abuse_alerts_after_repeated_violations(
    client,
    auth_overrides,
    buyer,
    api_key,
    live_tool,
    fake_redis,
    monkeypatch,
):
    auth_overrides(api_key_context=(buyer, api_key))
    fake_redis.values[f"ratelimit:{api_key.id}"] = 100
    fake_redis.values[f"gateway-abuse:{api_key.id}"] = 2
    alerts = []

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway.alert_service, "send_alert", fake_send_alert)
    monkeypatch.setattr(gateway.settings, "gateway_rate_limit_violation_alert_threshold", 3)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 429
    assert alerts[0]["event"] == "gateway_rate_limit_abuse"
    assert alerts[0]["details"]["api_key_prefix"] == api_key.key_prefix


def test_usage_logged(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))
    captured = []

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        return httpx.Response(200, json={"result": "ok"}, headers={"content-type": "application/json"})

    async def fake_create_usage_log(entry):
        captured.append(entry)

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(usage_service, "create_usage_log", fake_create_usage_log)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 200
    assert len(captured) == 1
    assert captured[0].tool_id == live_tool.id
    assert captured[0].cost == Decimal("0.25")


def test_tool_not_found(client, auth_overrides, buyer, api_key, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)

    response = client.post("/api/v1/tools/missing-tool", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "tool_not_found"


def test_tool_not_live(client, auth_overrides, buyer, api_key, draft_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        return draft_tool

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)

    response = client.post(f"/api/v1/tools/{draft_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "tool_not_live"


def test_gateway_forwards_subpaths(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))
    captured = {}

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        captured["tool_path"] = tool_path
        return httpx.Response(200, json={"ok": True}, headers={"content-type": "application/json"})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)
    monkeypatch.setattr(usage_service, "create_usage_log", noop)

    response = client.post(
        f"/api/v1/tools/{live_tool.slug}/api/analyze",
        headers={"X-API-Key": "hm_live_test"},
        json={"text": "hello"},
    )

    assert response.status_code == 200
    assert captured["tool_path"] == "api/analyze"


def test_response_time_recorded(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        return httpx.Response(200, json={"result": "ok"}, headers={"content-type": "application/json"})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)
    monkeypatch.setattr(usage_service, "create_usage_log", noop)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 200
    assert int(response.headers["X-HackMarket-Response-Time-Ms"]) >= 1


def test_gateway_timeout_returns_504(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        raise httpx.ReadTimeout("timed out")

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)
    monkeypatch.setattr(usage_service, "create_usage_log", noop)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "TOOL_TIMEOUT"


def test_gateway_normalizes_platform_502_html(client, auth_overrides, buyer, api_key, live_tool, monkeypatch):
    auth_overrides(api_key_context=(buyer, api_key))

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(tool, request, body, request_id, tool_path=""):
        html = """
        <html>
          <head><title>502</title></head>
          <body>
            <h1>Bad Gateway</h1>
            <div>Request ID: abc123-PDX</div>
            <div>This service is currently unavailable. Please try again in a few minutes.</div>
            <footer>Powered by Render</footer>
          </body>
        </html>
        """
        return httpx.Response(502, text=html, headers={"content-type": "text/html"})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(gateway, "_forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)
    monkeypatch.setattr(usage_service, "create_usage_log", noop)

    response = client.post(f"/api/v1/tools/{live_tool.slug}", headers={"X-API-Key": "hm_live_test"}, json={"text": "hello"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "TOOL_UNAVAILABLE"
    assert response.json()["error"]["platform"] == "Render"
    assert response.json()["error"]["platform_request_id"] == "abc123-PDX"
