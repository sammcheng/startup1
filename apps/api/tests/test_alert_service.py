from app.services import alert_service


class FakeRedis:
    def __init__(self, reserved: bool = True):
        self.reserved = reserved
        self.calls = []

    async def set(self, key, value, *, ex, nx):
        self.calls.append({"key": key, "value": value, "ex": ex, "nx": nx})
        return self.reserved


async def test_send_alert_once_sends_first_alert(monkeypatch):
    sent = []
    redis = FakeRedis(reserved=True)

    async def fake_send_alert(event, **kwargs):
        sent.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(alert_service, "send_alert", fake_send_alert)
    monkeypatch.setattr(alert_service.settings, "alert_dedupe_ttl_seconds", 900)

    result = await alert_service.send_alert_once(
        redis,
        "worker_heartbeat_missing",
        dedupe_key="hackmarket:jobs:health",
        severity="critical",
        summary="Worker heartbeat is missing.",
    )

    assert result is True
    assert redis.calls == [
        {
            "key": "hackmarket:alerts:worker_heartbeat_missing:hackmarket:jobs:health",
            "value": "1",
            "ex": 900,
            "nx": True,
        }
    ]
    assert sent[0]["event"] == "worker_heartbeat_missing"
    assert sent[0]["details"]["dedupe_key"] == "hackmarket:jobs:health"
    assert sent[0]["details"]["dedupe_ttl_seconds"] == 900


async def test_send_alert_once_suppresses_duplicate(monkeypatch):
    sent = []
    redis = FakeRedis(reserved=False)

    async def fake_send_alert(event, **kwargs):
        sent.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(alert_service, "send_alert", fake_send_alert)

    result = await alert_service.send_alert_once(
        redis,
        "queue_depth_high",
        dedupe_key="hackmarket:jobs",
        ttl_seconds=60,
        summary="Queue is too deep.",
    )

    assert result is False
    assert sent == []
    assert redis.calls[0]["ex"] == 60
