import pytest

from app.services import bootstrap_service


@pytest.mark.asyncio
async def test_bootstrap_seed_disabled_does_not_open_database(monkeypatch):
    monkeypatch.setattr(bootstrap_service.settings, "enable_bootstrap_tool_seed", False)

    def fail_session_factory():
        raise AssertionError("bootstrap seed should not open a DB session when disabled")

    monkeypatch.setattr(bootstrap_service, "AsyncSessionLocal", fail_session_factory)

    await bootstrap_service.ensure_bootstrap_marketplace_data()
