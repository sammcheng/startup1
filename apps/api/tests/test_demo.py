import httpx

from app.routers import tools
from app.services import proxy_service, tool_service


def test_public_demo_forwards_live_tool_request(client, live_tool, monkeypatch):
    recorded_tool_ids = []
    flushed_tool_ids = []

    async def fake_get_tool_by_slug(db, slug):
        assert slug == live_tool.slug
        return live_tool

    async def fake_forward_request(**kwargs):
        assert kwargs["tool_slug"] == live_tool.slug
        return httpx.Response(200, json={"ok": True}, headers={"content-type": "application/json"})

    async def noop(*args, **kwargs):
        return None

    async def fake_increment_total_requests(redis, tool_id):
        recorded_tool_ids.append(tool_id)
        return 1

    async def fake_flush_total_requests_if_needed(redis, tool_id):
        flushed_tool_ids.append(tool_id)

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(proxy_service, "forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", fake_increment_total_requests)
    monkeypatch.setattr(
        tool_service, "flush_total_requests_if_needed", fake_flush_total_requests_if_needed
    )

    response = client.post(f"/v1/tools/{live_tool.slug}/demo", json={"text": "hello"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["X-Demo-RateLimit-Limit"] == "10"
    assert recorded_tool_ids == [live_tool.id]
    assert flushed_tool_ids == [live_tool.id]


def test_public_demo_rate_limit_enforced(client, live_tool, fake_redis, monkeypatch):
    fake_redis.values["demo-ratelimit:live-tool:test-client"] = 10

    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(tools, "_demo_client_identifier", lambda request: "test-client")

    response = client.post(f"/v1/tools/{live_tool.slug}/demo", json={"text": "hello"})

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limit_exceeded"


def test_public_demo_timeout_returns_504(client, live_tool, monkeypatch):
    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(**kwargs):
        raise httpx.ReadTimeout("timed out")

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(proxy_service, "forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)

    response = client.post(f"/v1/tools/{live_tool.slug}/demo", json={"text": "hello"})

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "TOOL_TIMEOUT"


def test_public_demo_normalizes_platform_502_html(client, live_tool, monkeypatch):
    async def fake_get_tool_by_slug(db, slug):
        return live_tool

    async def fake_forward_request(**kwargs):
        html = """
        <html>
          <head><title>502</title></head>
          <body>
            <h1>Bad Gateway</h1>
            <div>Request ID: demo123-PDX</div>
            <div>This service is currently unavailable. Please try again in a few minutes.</div>
            <footer>Powered by Render</footer>
          </body>
        </html>
        """
        return httpx.Response(502, text=html, headers={"content-type": "text/html"})

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(tool_service, "get_tool_by_slug", fake_get_tool_by_slug)
    monkeypatch.setattr(proxy_service, "forward_request", fake_forward_request)
    monkeypatch.setattr(tool_service, "increment_total_requests", noop)
    monkeypatch.setattr(tool_service, "flush_total_requests_if_needed", noop)

    response = client.post(f"/v1/tools/{live_tool.slug}/demo", json={"text": "hello"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "TOOL_UNAVAILABLE"
    assert response.json()["error"]["platform"] == "Render"
    assert response.json()["error"]["platform_request_id"] == "demo123-PDX"
