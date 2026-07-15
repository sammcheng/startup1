from app import dependencies, main


async def fake_healthy_processing_jobs(db):
    return {
        "stuck_active": 0,
        "failed_recent": 0,
        "stale_after_seconds": 1800,
        "failed_threshold": 3,
        "failed_window_seconds": 900,
    }


async def fake_healthy_stripe_webhooks(db):
    return {
        "stuck_active": 0,
        "failed_recent": 0,
        "stale_after_seconds": 900,
        "failed_threshold": 1,
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


def test_debug_only_url_is_disabled_when_debug_is_false(monkeypatch):
    monkeypatch.setattr(main.settings, "debug", False)

    assert main.debug_only_url("/openapi.json") is None


def test_debug_only_url_is_enabled_when_debug_is_true(monkeypatch):
    monkeypatch.setattr(main.settings, "debug", True)

    assert main.debug_only_url("/openapi.json") == "/openapi.json"


def test_request_id_preserves_safe_client_id(client):
    response = client.get("/health", headers={"X-HackMarket-Request-Id": "req_123.safe:trace-1"})

    assert response.headers["X-HackMarket-Request-Id"] == "req_123.safe:trace-1"


def test_request_id_replaces_unsafe_client_id(client):
    unsafe_request_id = "req_123\nSet-Cookie: leaked=true"

    response = client.get("/health", headers={"X-HackMarket-Request-Id": unsafe_request_id})

    assert response.headers["X-HackMarket-Request-Id"] != unsafe_request_id
    assert "\n" not in response.headers["X-HackMarket-Request-Id"]
    assert len(response.headers["X-HackMarket-Request-Id"]) <= 128


def test_request_id_replaces_oversized_client_id(client):
    oversized_request_id = "a" * 129

    response = client.get("/health", headers={"X-HackMarket-Request-Id": oversized_request_id})

    assert response.headers["X-HackMarket-Request-Id"] != oversized_request_id
    assert len(response.headers["X-HackMarket-Request-Id"]) <= 128


def test_request_body_limit_rejects_invalid_content_length(client):
    response = client.post(
        "/v1/tools/discover",
        content=b"{}",
        headers={"Content-Length": "not-a-number"},
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "INVALID_CONTENT_LENGTH"
    assert error["status"] == 400
    assert error["request_id"] == response.headers["X-HackMarket-Request-Id"]
    assert error["details"] == {}


def test_request_body_limit_rejects_declared_oversized_body(client, monkeypatch):
    monkeypatch.setattr("app.main.settings.max_request_body_bytes", 4)

    response = client.post(
        "/v1/tools/discover",
        content=b"{}",
        headers={"Content-Length": "5"},
    )

    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "REQUEST_TOO_LARGE"
    assert error["status"] == 413
    assert error["request_id"] == response.headers["X-HackMarket-Request-Id"]
    assert error["details"] == {"max_request_body_bytes": 4}


def test_validation_errors_strip_raw_input_when_debug_is_disabled(client, monkeypatch):
    monkeypatch.setattr("app.middleware.error_handler.settings.debug", False)

    response = client.post(
        "/v1/tools/discover",
        json={"query": {"secret": "sk_live_should_not_echo"}, "limit": "not-a-number"},
    )

    assert response.status_code == 422
    errors = response.json()["error"]["details"]["errors"]
    assert errors
    assert all("input" not in error for error in errors)
    assert "sk_live_should_not_echo" not in response.text


def test_validation_errors_keep_raw_input_when_debug_is_enabled(client, monkeypatch):
    monkeypatch.setattr("app.middleware.error_handler.settings.debug", True)

    response = client.post(
        "/v1/tools/discover",
        json={"query": {"secret": "debug-secret"}, "limit": "not-a-number"},
    )

    assert response.status_code == 422
    assert any("input" in error for error in response.json()["error"]["details"]["errors"])
    assert "debug-secret" in response.text


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
    monkeypatch.setattr(
        "app.services.operations_health_service.job_service.processing_job_health",
        fake_healthy_processing_jobs,
    )
    monkeypatch.setattr(
        "app.services.operations_health_service.stripe_event_service.webhook_event_health",
        fake_healthy_stripe_webhooks,
    )
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["operations_status"] == "degraded"
    assert payload["checks"]["queue"] == "degraded_high_depth"
    assert payload["checks"]["worker"] == "missing_heartbeat"
    assert payload["checks"]["processing_jobs"] == "ok"
    assert payload["checks"]["stripe_webhooks"] == "ok"
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
    ]
    assert dedupe_keys == [
        "hackmarket:jobs",
        "hackmarket:jobs:health",
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
    monkeypatch.setattr(
        "app.services.operations_health_service.job_service.processing_job_health",
        fake_healthy_processing_jobs,
    )
    monkeypatch.setattr(
        "app.services.operations_health_service.stripe_event_service.webhook_event_health",
        fake_healthy_stripe_webhooks,
    )

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["checks"]["queue"] == "ok"
    assert payload["checks"]["worker"] == "ok"
    assert payload["checks"]["processing_jobs"] == "ok"
    assert payload["checks"]["stripe_webhooks"] == "ok"
    assert payload["operations_status"] == "healthy"
    assert payload["queue"]["depth"] == 2
    assert payload["queue"]["worker_heartbeat"] is True
    assert payload["processing_jobs"]["stuck_active"] == 0
    assert payload["stripe_webhooks"]["stuck_active"] == 0


def test_ready_isolates_operations_probe_failure_from_core_readiness(client, monkeypatch):
    alerts = []

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

    async def fake_operations_health(db, redis):
        raise RuntimeError("operations query failed")

    async def fake_send_alert_once(redis, event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeProductionRedis())
    monkeypatch.setattr("app.main.settings.environment", "production")
    monkeypatch.setattr(
        "app.main.operations_health_service.get_operations_health",
        fake_operations_health,
    )
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["operations_status"] == "degraded"
    assert payload["checks"] == {
        "database": "ok",
        "redis": "ok",
        "operations": "error: RuntimeError",
    }
    assert alerts[0]["event"] == "operations_health_check_failed"
    assert alerts[0]["details"] == {"error_type": "RuntimeError"}


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
    monkeypatch.setattr(
        "app.services.operations_health_service.job_service.processing_job_health",
        fake_processing_jobs,
    )
    monkeypatch.setattr(
        "app.services.operations_health_service.stripe_event_service.webhook_event_health",
        fake_healthy_stripe_webhooks,
    )
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["operations_status"] == "degraded"
    assert payload["checks"]["processing_jobs"] == "degraded_stuck_active_and_failed_recent"
    assert payload["processing_jobs"]["stuck_active"] == 2
    assert payload["processing_jobs"]["failed_recent"] == 4
    assert [alert["event"] for alert in alerts] == [
        "processing_jobs_stuck",
        "processing_jobs_failed",
    ]
    assert dedupe_keys == [
        "stuck-active:1800",
        "failed-recent:900",
    ]


def test_ready_alerts_on_stripe_webhook_risk(client, monkeypatch):
    alerts = []

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

    async def fake_stripe_webhooks(db):
        return {
            "stuck_active": 2,
            "failed_recent": 1,
            "stale_after_seconds": 900,
            "failed_threshold": 1,
            "failed_window_seconds": 900,
        }

    async def fake_send_alert_once(redis, event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(dependencies, "AsyncSessionLocal", lambda: FakeReadySession())
    monkeypatch.setattr(dependencies, "_redis_client", FakeProductionRedis())
    monkeypatch.setattr("app.main.settings.environment", "production")
    monkeypatch.setattr("app.main.settings.alert_queue_depth_threshold", 100)
    monkeypatch.setattr("app.main.settings.alert_stripe_webhook_stale_after_seconds", 900)
    monkeypatch.setattr("app.main.settings.alert_failed_stripe_webhooks_window_seconds", 900)
    monkeypatch.setattr(
        "app.services.operations_health_service.job_service.processing_job_health",
        fake_healthy_processing_jobs,
    )
    monkeypatch.setattr(
        "app.services.operations_health_service.stripe_event_service.webhook_event_health",
        fake_stripe_webhooks,
    )
    monkeypatch.setattr("app.main.alert_service.send_alert_once", fake_send_alert_once)

    response = client.get("/ready")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["operations_status"] == "degraded"
    assert payload["checks"]["stripe_webhooks"] == "degraded_stuck_active_and_failed_recent"
    assert payload["stripe_webhooks"]["stuck_active"] == 2
    assert [alert["event"] for alert in alerts] == [
        "stripe_webhooks_stuck",
        "stripe_webhooks_failed",
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
