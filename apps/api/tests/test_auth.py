import pytest

import app.dependencies as auth_dependencies
from app.dependencies import get_current_identity
from app.exceptions import Unauthorized
from app.main import app
from app.routers import auth
from app.schemas.auth import AuthSyncRequest
from app.services import auth_service


def test_auth_sync_returns_user_payload(client, buyer, monkeypatch):
    async def fake_identity():
        return auth_service.AuthIdentity(
            clerk_id="clerk_test_user",
            email=buyer.email,
            username=buyer.username,
            display_name=buyer.display_name,
            avatar_url=buyer.avatar_url,
        )

    async def fake_sync_user_from_identity(db, identity, profile):
        buyer.clerk_id = identity.clerk_id
        return buyer

    app.dependency_overrides[get_current_identity] = fake_identity
    monkeypatch.setattr(auth_service, "sync_user_from_identity", fake_sync_user_from_identity)
    monkeypatch.setattr("app.routers.auth.sync_user_from_identity", fake_sync_user_from_identity)

    response = client.post(
        "/v1/auth/sync",
        json={
            "email": buyer.email,
            "username": buyer.username,
            "display_name": buyer.display_name,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["clerk_id"] == "clerk_test_user"
    assert payload["email"] == buyer.email
    assert payload["username"] == buyer.username
    assert payload["role"] == buyer.role.value


def test_clerk_webhook_requires_configured_secret(client, monkeypatch):
    monkeypatch.setattr(auth.settings, "clerk_webhook_secret", "")

    response = client.post("/v1/auth/webhook", content=b"{}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "misconfiguration"


def test_clerk_webhook_rejects_invalid_signature(client, monkeypatch):
    alerts = []

    class FakeWebhook:
        def __init__(self, secret):
            assert secret == "whsec_test"

        def verify(self, body, headers):
            raise auth.WebhookVerificationError()

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(auth.settings, "clerk_webhook_secret", "whsec_test")
    monkeypatch.setattr(auth, "Webhook", FakeWebhook)
    monkeypatch.setattr(auth.alert_service, "send_alert", fake_send_alert)

    response = client.post(
        "/v1/auth/webhook",
        content=b"{}",
        headers={
            "svix-id": "msg_test",
            "svix-timestamp": "123",
            "svix-signature": "bad",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_signature"
    assert alerts[0]["event"] == "clerk_webhook_invalid_signature"


def test_clerk_webhook_dispatches_verified_user_created_event(client, monkeypatch):
    handled = []
    clerk_user = {
        "id": "clerk_created",
        "primary_email_address_id": "email_1",
        "email_addresses": [{"id": "email_1", "email_address": "created@example.com"}],
        "username": "created-user",
    }

    class FakeWebhook:
        def __init__(self, secret):
            assert secret == "whsec_test"

        def verify(self, body, headers):
            assert body == b'{"type":"user.created"}'
            assert headers["svix-id"] == "msg_test"
            return {"type": "user.created", "data": clerk_user}

    async def fake_handle_user_created(db, clerk_id, payload):
        handled.append((clerk_id, payload))

    monkeypatch.setattr(auth.settings, "clerk_webhook_secret", "whsec_test")
    monkeypatch.setattr(auth, "Webhook", FakeWebhook)
    monkeypatch.setattr(auth, "_handle_user_created", fake_handle_user_created)

    response = client.post(
        "/v1/auth/webhook",
        content=b'{"type":"user.created"}',
        headers={
            "svix-id": "msg_test",
            "svix-timestamp": "123",
            "svix-signature": "sig_test",
        },
    )

    assert response.status_code == 204
    assert handled == [("clerk_created", clerk_user)]


@pytest.mark.asyncio
async def test_clerk_user_created_webhook_sanitizes_avatar_url():
    db = _FakeAuthSession()
    clerk_user = {
        "id": "clerk_created_unsafe_avatar",
        "primary_email_address_id": "email_1",
        "email_addresses": [{"id": "email_1", "email_address": "created@example.com"}],
        "username": "created-user",
        "image_url": "javascript:alert(1)",
    }

    await auth._handle_user_created(db, "clerk_created_unsafe_avatar", clerk_user)

    assert db.added[0].avatar_url is None
    assert db.commits == 1


@pytest.mark.asyncio
async def test_clerk_user_updated_webhook_accepts_only_https_avatar_url():
    db = _FakeAuthSession()
    clerk_user = {
        "id": "clerk_updated_safe_avatar",
        "primary_email_address_id": "email_1",
        "email_addresses": [{"id": "email_1", "email_address": "updated@example.com"}],
        "username": "updated-user",
        "image_url": "https://images.clerk.dev/updated.png",
    }

    await auth._handle_user_updated(db, "clerk_updated_safe_avatar", clerk_user)

    assert db.added[0].avatar_url == "https://images.clerk.dev/updated.png"
    assert db.commits == 1


def test_resolve_jwks_url_falls_back_to_issuer(monkeypatch):
    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(auth_dependencies.settings, "clerk_issuer_url", "")
    monkeypatch.setattr(
        auth_dependencies.jwt,
        "decode",
        lambda token, options: {"iss": "https://cool-magpie-14.clerk.accounts.dev"},
    )

    jwks_url = auth_dependencies._resolve_jwks_url("fake-token")

    assert jwks_url == "https://cool-magpie-14.clerk.accounts.dev/.well-known/jwks.json"


def test_resolve_jwks_url_rejects_untrusted_issuer(monkeypatch):
    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(auth_dependencies.settings, "clerk_issuer_url", "")
    monkeypatch.setattr(
        auth_dependencies.jwt,
        "decode",
        lambda token, options: {"iss": "https://attacker.example.com"},
    )

    with pytest.raises(Unauthorized):
        auth_dependencies._resolve_jwks_url("fake-token")


def test_resolve_jwks_url_prefers_configured_clerk_issuer(monkeypatch):
    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(
        auth_dependencies.settings,
        "clerk_issuer_url",
        "https://pleasing-racer-55.clerk.accounts.dev/",
    )

    jwks_url = auth_dependencies._resolve_jwks_url("fake-token")

    assert jwks_url == "https://pleasing-racer-55.clerk.accounts.dev/.well-known/jwks.json"


@pytest.mark.asyncio
async def test_verify_clerk_identity_validates_configured_issuer(monkeypatch):
    async def fake_get_jwks(jwks_url):
        assert jwks_url == "https://pleasing-racer-55.clerk.accounts.dev/.well-known/jwks.json"
        return [{"kid": "kid_123"}]

    def fake_decode(token, signing_key, *, algorithms, issuer, options):
        assert token == "fake-token"
        assert signing_key == "public-key"
        assert algorithms == ["RS256"]
        assert issuer == "https://pleasing-racer-55.clerk.accounts.dev"
        assert options == {"verify_aud": False}
        return {
            "sub": "clerk_verified",
            "email": "verified@example.com",
            "username": "verified",
            "name": "Verified User",
        }

    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(
        auth_dependencies.settings,
        "clerk_issuer_url",
        "https://pleasing-racer-55.clerk.accounts.dev/",
    )
    monkeypatch.setattr(
        auth_dependencies.jwt, "get_unverified_header", lambda token: {"kid": "kid_123"}
    )
    monkeypatch.setattr(
        auth_dependencies.jwt.PyJWK,
        "from_dict",
        lambda jwk: type("SigningKey", (), {"key": "public-key"})(),
    )
    monkeypatch.setattr(auth_dependencies, "_get_jwks", fake_get_jwks)
    monkeypatch.setattr(auth_dependencies.jwt, "decode", fake_decode)

    identity = await auth_dependencies.verify_clerk_identity("fake-token")

    assert identity.clerk_id == "clerk_verified"
    assert identity.email == "verified@example.com"


class _FakeAuthResult:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _FakeAuthSession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.refreshed = []

    async def execute(self, statement):
        return _FakeAuthResult()

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


@pytest.mark.asyncio
async def test_sync_user_trusts_verified_identity_email_over_client_body():
    db = _FakeAuthSession()
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_verified",
        email="verified@example.com",
        username="verified-user",
        display_name="Verified User",
    )
    profile = AuthSyncRequest(
        email="attacker@example.com",
        username="client-user",
        display_name="Client User",
    )

    user = await auth_service.sync_user_from_identity(db, identity, profile)

    assert user.email == "verified@example.com"
    assert db.added == [user]
    assert db.commits == 1


@pytest.mark.asyncio
async def test_sync_user_accepts_https_avatar_url():
    db = _FakeAuthSession()
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_avatar",
        email="avatar@example.com",
        username="avatar-user",
        display_name="Avatar User",
        avatar_url="https://images.clerk.dev/avatar.png",
    )

    user = await auth_service.sync_user_from_identity(db, identity)

    assert user.avatar_url == "https://images.clerk.dev/avatar.png"


@pytest.mark.asyncio
async def test_sync_user_drops_unsafe_avatar_urls():
    db = _FakeAuthSession()
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_unsafe_avatar",
        email="avatar@example.com",
        username="avatar-user",
        display_name="Avatar User",
        avatar_url="javascript:alert(1)",
    )
    profile = AuthSyncRequest(
        email="avatar@example.com",
        username="avatar-user",
        display_name="Avatar User",
        avatar_url="http://example.com/avatar.png",
    )

    user = await auth_service.sync_user_from_identity(db, identity, profile)

    assert user.avatar_url is None


@pytest.mark.asyncio
async def test_sync_user_rejects_client_email_fallback_in_production(monkeypatch):
    db = _FakeAuthSession()
    monkeypatch.setattr(auth_service.settings, "environment", "production")
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_no_email",
        email=None,
        username="no-email",
        display_name="No Email",
    )
    profile = AuthSyncRequest(
        email="client-claimed@example.com",
        username="client-user",
        display_name="Client User",
    )

    with pytest.raises(ValueError, match="email address is required"):
        await auth_service.sync_user_from_identity(db, identity, profile)

    assert db.added == []
    assert db.commits == 0


def test_auth_sync_returns_401_when_verified_identity_has_no_email(client, monkeypatch):
    async def fake_identity():
        return auth_service.AuthIdentity(
            clerk_id="clerk_no_email",
            email=None,
            username="no-email",
            display_name="No Email",
        )

    monkeypatch.setattr(auth_service.settings, "environment", "production")
    app.dependency_overrides[get_current_identity] = fake_identity

    response = client.post(
        "/v1/auth/sync",
        json={
            "email": "client-claimed@example.com",
            "username": "client-user",
            "display_name": "Client User",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_get_current_user_lazily_syncs_verified_identity(monkeypatch):
    db = _FakeAuthSession()
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_lazy",
        email="lazy@example.com",
        username="lazy-user",
        display_name="Lazy User",
    )

    async def fake_verify_clerk_identity(token):
        assert token == "test-token"
        return identity

    monkeypatch.setattr(auth_dependencies, "verify_clerk_identity", fake_verify_clerk_identity)

    user = await auth_dependencies.get_current_user(db=db, authorization="Bearer test-token")

    assert user.clerk_id == "clerk_lazy"
    assert user.email == "lazy@example.com"
    assert user.username == "lazy-user"
    assert user.is_active is True
    assert db.added == [user]
    assert db.commits == 1
