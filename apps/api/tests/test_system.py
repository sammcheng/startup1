from app import dependencies


def test_health_returns_environment_and_version(client):
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["environment"] == "test"
    assert payload["version"]


def test_responses_include_security_headers(client):
    response = client.get("/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"


def test_ready_returns_ready_when_dependencies_respond(client, monkeypatch):
    class FakeReadySession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, statement):
            return None

    class FakeReadyRedis:
        async def ping(self):
            return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeReadyRedis())

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"] == {"database": "ok", "redis": "ok"}


def test_ready_returns_degraded_when_dependency_fails(client, monkeypatch):
    class FakeBrokenSession:
        async def __aenter__(self):
            raise RuntimeError("database unavailable")

        async def __aexit__(self, exc_type, exc, tb):
            return None

    class FakeReadyRedis:
        async def ping(self):
            return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeBrokenSession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeReadyRedis())

    response = client.get("/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["checks"]["database"] == "error: RuntimeError"
    assert payload["checks"]["redis"] == "ok"


def test_cors_allows_configured_origin(client):
    response = client.options(
        "/v1/tools/discover",
        headers={
            "Origin": "https://hackmarket.io",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://hackmarket.io"


def test_cors_rejects_unconfigured_origin(client):
    response = client.options(
        "/v1/tools/discover",
        headers={
            "Origin": "https://attacker.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
