from app.config import settings
from app.routers import tools
from app.services import discovery_service


def test_public_discovery_rate_limit_enforced(client, fake_redis, monkeypatch):
    monkeypatch.setattr(settings, "public_rate_limit_per_minute", 1)
    monkeypatch.setattr(tools, "_demo_client_identifier", lambda request: "test-client")

    async def fake_discover_tools(db, query, categories, limit):
        return []

    monkeypatch.setattr(discovery_service, "discover_tools", fake_discover_tools)

    first = client.post("/v1/tools/discover", json={"query": "pdf", "limit": 3})
    second = client.post("/v1/tools/discover", json={"query": "pdf", "limit": 3})

    assert first.status_code == 200
    assert first.json() == {"matches": [], "query": "pdf"}
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"
    assert second.headers["X-RateLimit-Limit"] == "1"
    assert second.headers["X-RateLimit-Remaining"] == "0"
    assert second.headers["Retry-After"] == "60"
    assert fake_redis.values["rl:public:discover:test-client"] == 2
