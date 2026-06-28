import pytest

from app.exceptions import AppError
from app.dependencies import validate_api_key
from app.main import app
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

    async def fake_get_api_key_by_id(db, key_id):
        return api_key

    async def fake_deactivate_api_key(db, key):
        key.is_active = False
        return key

    monkeypatch.setattr(api_key_service, "get_api_key_by_id", fake_get_api_key_by_id)
    monkeypatch.setattr(api_key_service, "deactivate_api_key", fake_deactivate_api_key)

    response = client.delete(f"/v1/api-keys/{api_key.id}")

    assert response.status_code == 204
    assert api_key.is_active is False


@pytest.mark.asyncio
async def test_key_hashing(fake_db, buyer, monkeypatch):
    from app.utils import hashing

    monkeypatch.setattr(hashing, "generate_api_key", lambda: "hm_live_static_secret")

    api_key, raw_key = await api_key_service.create_api_key(fake_db, buyer.id, "testing")

    assert raw_key == "hm_live_static_secret"
    assert api_key.key_hash == hash_api_key(raw_key)


@pytest.mark.asyncio
async def test_create_key_rejects_when_active_key_limit_reached(buyer, monkeypatch):
    class FakeScalarResult:
        def scalar_one(self):
            return 1

    class FakeLimitDb:
        async def execute(self, statement):
            return FakeScalarResult()

    monkeypatch.setattr(api_key_service.settings, "max_active_api_keys_per_user", 1)

    with pytest.raises(AppError) as exc:
        await api_key_service.create_api_key(FakeLimitDb(), buyer.id, "extra")

    assert exc.value.error_code == "api_key_limit_reached"
