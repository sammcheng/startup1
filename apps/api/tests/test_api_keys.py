import pytest

from app.exceptions import AppError
from app.services import api_key_service
from app.utils.hashing import hash_api_key


def test_create_key(client, auth_overrides, buyer, api_key_factory, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_create_api_key(db, user_id, name):
        api_key = api_key_factory(user=buyer)
        api_key.name = name
        return api_key, "hm_live_raw_secret"

    monkeypatch.setattr(api_key_service, "create_api_key", fake_create_api_key)

    response = client.post("/v1/api-keys", json={"name": "production"})

    assert response.status_code == 201
    assert response.json()["key"] == "hm_live_raw_secret"
    assert response.json()["name"] == "production"


def test_list_keys_no_raw(client, auth_overrides, buyer, api_key, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_list_api_keys(db, user_id):
        return [api_key]

    monkeypatch.setattr(api_key_service, "list_api_keys", fake_list_api_keys)

    response = client.get("/v1/api-keys")

    assert response.status_code == 200
    assert "key_hash" not in response.text
    assert "hm_live_raw_secret" not in response.text


def test_deactivate_key(client, auth_overrides, buyer, api_key, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_get_api_key_for_user(db, key_id, user_id):
        assert user_id == buyer.id
        return api_key

    async def fake_deactivate_api_key(db, key):
        key.is_active = False
        return key

    monkeypatch.setattr(api_key_service, "get_api_key_for_user", fake_get_api_key_for_user)
    monkeypatch.setattr(api_key_service, "deactivate_api_key", fake_deactivate_api_key)

    response = client.delete(f"/v1/api-keys/{api_key.id}")

    assert response.status_code == 204
    assert api_key.is_active is False


def test_deactivate_key_returns_not_found_for_missing_or_not_owned_key(client, auth_overrides, buyer, api_key, monkeypatch):
    auth_overrides(current_user=buyer)
    deactivated = []

    async def fake_get_api_key_for_user(db, key_id, user_id):
        assert key_id == api_key.id
        assert user_id == buyer.id
        return None

    async def fake_deactivate_api_key(db, key):
        deactivated.append(key)
        return key

    monkeypatch.setattr(api_key_service, "get_api_key_for_user", fake_get_api_key_for_user)
    monkeypatch.setattr(api_key_service, "deactivate_api_key", fake_deactivate_api_key)

    response = client.delete(f"/v1/api-keys/{api_key.id}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "api_key_not_found"
    assert deactivated == []


@pytest.mark.asyncio
async def test_key_hashing(fake_db, buyer, monkeypatch):
    from app.utils import hashing

    monkeypatch.setattr(hashing, "generate_api_key", lambda: "hm_live_static_secret")

    api_key, raw_key = await api_key_service.create_api_key(fake_db, buyer.id, "testing")

    assert raw_key == "hm_live_static_secret"
    assert api_key.key_hash == hash_api_key(raw_key)


@pytest.mark.asyncio
async def test_create_key_rejects_when_active_key_limit_reached(buyer, monkeypatch):
    class FakeLockResult:
        pass

    class FakeCountResult:
        def scalar_one(self):
            return 1

    class FakeLimitDb:
        def __init__(self):
            self.execute_calls = 0

        async def execute(self, statement):
            self.execute_calls += 1
            if self.execute_calls == 1:
                return FakeLockResult()
            return FakeCountResult()

    monkeypatch.setattr(api_key_service.settings, "max_active_api_keys_per_user", 1)
    db = FakeLimitDb()

    with pytest.raises(AppError) as exc:
        await api_key_service.create_api_key(db, buyer.id, "extra")

    assert exc.value.error_code == "api_key_limit_reached"
    assert db.execute_calls == 2


@pytest.mark.asyncio
async def test_create_key_locks_user_before_counting_active_keys(buyer, monkeypatch):
    calls = []

    class FakeCreateDb:
        def __init__(self):
            self.added = []

        async def execute(self, statement):
            raise AssertionError("lock/count helpers are patched for this test")

        def add(self, obj):
            self.added.append(obj)

        async def commit(self):
            return None

        async def refresh(self, obj):
            return None

    async def fake_lock_user(db, user_id):
        calls.append(("lock", user_id))

    async def fake_count_active_api_keys(db, user_id):
        calls.append(("count", user_id))
        return 0

    monkeypatch.setattr(api_key_service, "_lock_user_for_api_key_create", fake_lock_user)
    monkeypatch.setattr(api_key_service, "count_active_api_keys", fake_count_active_api_keys)

    await api_key_service.create_api_key(FakeCreateDb(), buyer.id, "production")

    assert calls == [("lock", buyer.id), ("count", buyer.id)]
