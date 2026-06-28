from app import dependencies


async def fake_healthy_processing_jobs(db):
    return {
        "stuck_active": 0,
        "failed_recent": 0,
        "stale_after_seconds": 1800,
        "failed_threshold": 3,
        "failed_window_seconds": 900,
    }


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


def test_ready_alerts_on_production_queue_risk(client, monkeypatch):
    alerts = []
    dedupe_keys = []

    class FakeReadySession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, statement):
            return None

    class FakeProductionRedis:
        async def ping(self):
            return True

        async def zcard(self, key):
            return 101

        async def get(self, key):
            return None

    async def fake_send_alert_once(redis, event, **kwargs):
        dedupe_keys.append(kwargs["dedupe_key"])
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeProductionRedis())
    monkeypatch.setattr("app.main.settings.environment", "production")
    monkeypatch.setattr("app.main.settings.alert_queue_depth_threshold", 100)
    monkeypatch.setattr("app.main.job_service.processing_job_health", fake_healthy_processing_jobs)
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["checks"]["queue"] == "degraded_high_depth"
    assert payload["checks"]["worker"] == "missing_heartbeat"
    assert payload["checks"]["processing_jobs"] == "ok"
    assert payload["queue"] == {
        "name": "hackmarket:jobs",
        "depth": 101,
        "depth_threshold": 100,
        "worker_heartbeat": False,
        "worker_health_check_key": "hackmarket:jobs:health",
    }
    assert [alert["event"] for alert in alerts] == [
        "queue_depth_high",
        "worker_heartbeat_missing",
        "api_readiness_degraded",
    ]
    assert dedupe_keys == [
        "hackmarket:jobs",
        "hackmarket:jobs:health",
        "database:ok,processing_jobs:ok,queue:degraded_high_depth,redis:ok,worker:missing_heartbeat",
    ]


def test_ready_returns_production_queue_details_when_worker_is_healthy(client, monkeypatch):
    class FakeReadySession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, statement):
            return None

    class FakeProductionRedis:
        async def ping(self):
            return True

        async def zcard(self, key):
            return 2

        async def get(self, key):
            return "1"

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeProductionRedis())
    monkeypatch.setattr("app.main.settings.environment", "production")
    monkeypatch.setattr("app.main.settings.alert_queue_depth_threshold", 100)
    monkeypatch.setattr("app.main.job_service.processing_job_health", fake_healthy_processing_jobs)

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["queue"] == "ok"
    assert payload["checks"]["worker"] == "ok"
    assert payload["checks"]["processing_jobs"] == "ok"
    assert payload["queue"]["depth"] == 2
    assert payload["queue"]["worker_heartbeat"] is True
    assert payload["processing_jobs"]["stuck_active"] == 0


def test_ready_alerts_on_processing_job_risk(client, monkeypatch):
    alerts = []
    dedupe_keys = []

    class FakeReadySession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def execute(self, statement):
            return None

    class FakeProductionRedis:
        async def ping(self):
            return True

        async def zcard(self, key):
            return 0

        async def get(self, key):
            return "1"

    async def fake_processing_jobs(db):
        return {
            "stuck_active": 2,
            "failed_recent": 4,
            "stale_after_seconds": 1800,
            "failed_threshold": 3,
            "failed_window_seconds": 900,
        }

    async def fake_send_alert_once(redis, event, **kwargs):
        dedupe_keys.append(kwargs["dedupe_key"])
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeProductionRedis())
    monkeypatch.setattr("app.main.settings.environment", "production")
    monkeypatch.setattr("app.main.settings.alert_queue_depth_threshold", 100)
    monkeypatch.setattr("app.main.settings.alert_processing_job_stale_after_seconds", 1800)
    monkeypatch.setattr("app.main.settings.alert_failed_processing_jobs_window_seconds", 900)
    monkeypatch.setattr("app.main.job_service.processing_job_health", fake_processing_jobs)
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["checks"]["processing_jobs"] == "degraded_stuck_active_and_failed_recent"
    assert payload["processing_jobs"]["stuck_active"] == 2
    assert payload["processing_jobs"]["failed_recent"] == 4
    assert [alert["event"] for alert in alerts] == [
        "processing_jobs_stuck",
        "processing_jobs_failed",
        "api_readiness_degraded",
    ]
    assert dedupe_keys == [
        "stuck-active:1800",
        "failed-recent:900",
        "database:ok,processing_jobs:degraded_stuck_active_and_failed_recent,queue:ok,redis:ok,worker:ok",
    ]


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
