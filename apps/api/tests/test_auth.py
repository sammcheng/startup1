import pytest
from sqlalchemy.exc import IntegrityError

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


def test_auth_sync_rejects_suspended_account(client, buyer, monkeypatch):
    buyer.is_active = False

    async def fake_identity():
        return auth_service.AuthIdentity(
            clerk_id=buyer.clerk_id,
            email=buyer.email,
            username=buyer.username,
            display_name=buyer.display_name,
        )

    async def fake_sync_user_from_identity(db, identity, profile):
        return buyer

    app.dependency_overrides[get_current_identity] = fake_identity
    monkeypatch.setattr(auth, "sync_user_from_identity", fake_sync_user_from_identity)

    response = client.post(
        "/v1/auth/sync",
        json={
            "email": buyer.email,
            "username": buyer.username,
            "display_name": buyer.display_name,
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "This account is suspended."


def test_auth_sync_returns_conflict_for_linked_verified_email(client, buyer, monkeypatch):
    async def fake_identity():
        return auth_service.AuthIdentity(
            clerk_id="clerk_duplicate_email",
            email=buyer.email,
            username="duplicate-email",
        )

    async def fake_sync_user_from_identity(db, identity, profile):
        raise auth_service.AccountSyncConflictError()

    app.dependency_overrides[get_current_identity] = fake_identity
    monkeypatch.setattr(auth, "sync_user_from_identity", fake_sync_user_from_identity)

    response = client.post(
        "/v1/auth/sync",
        json={
            "email": buyer.email,
            "username": "duplicate-email",
            "display_name": "Duplicate Email",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_sync_conflict"


@pytest.mark.asyncio
async def test_account_can_use_seller_capabilities_from_buyer_role(buyer):
    assert await auth_dependencies.require_seller(buyer) is buyer


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


def test_clerk_webhook_alerts_and_acknowledges_account_conflict(client, monkeypatch):
    alerts = []

    class FakeWebhook:
        def __init__(self, secret):
            assert secret == "whsec_test"

        def verify(self, body, headers):
            return {
                "type": "user.created",
                "data": {"id": "clerk_conflicting_user"},
            }

    async def fake_handle_user_created(db, clerk_id, payload):
        raise auth_service.AccountSyncConflictError()

    async def fake_send_alert(event, **kwargs):
        alerts.append({"event": event, **kwargs})
        return True

    monkeypatch.setattr(auth.settings, "clerk_webhook_secret", "whsec_test")
    monkeypatch.setattr(auth, "Webhook", FakeWebhook)
    monkeypatch.setattr(auth, "_handle_user_created", fake_handle_user_created)
    monkeypatch.setattr(auth.alert_service, "send_alert", fake_send_alert)

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
    assert alerts[0]["event"] == "clerk_account_sync_conflict"
    assert alerts[0]["details"]["event_type"] == "user.created"


def test_clerk_webhook_retries_temporary_account_sync_race(client, monkeypatch):
    class FakeWebhook:
        def __init__(self, secret):
            assert secret == "whsec_test"

        def verify(self, body, headers):
            return {
                "type": "user.created",
                "data": {"id": "clerk_racing_user"},
            }

    async def fake_handle_user_created(db, clerk_id, payload):
        raise auth_service.AccountSyncRetryError()

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

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "account_sync_retry"
    assert response.json()["error"]["details"] == {"retryable": True}


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


def test_resolve_jwks_url_rejects_untrusted_configured_jwks(monkeypatch):
    monkeypatch.setattr(
        auth_dependencies.settings,
        "clerk_jwks_url",
        "https://attacker.example.com/.well-known/jwks.json",
    )

    with pytest.raises(Unauthorized, match="JWKS"):
        auth_dependencies._resolve_jwks_url("fake-token")


def test_clerk_authorized_party_must_match_frontend_origin(monkeypatch):
    monkeypatch.setattr(
        auth_dependencies.settings,
        "cors_origins",
        ["https://app.hackmarket.example"],
    )
    monkeypatch.setattr(
        auth_dependencies.settings,
        "app_base_url",
        "https://app.hackmarket.example",
    )

    auth_dependencies._validate_clerk_authorized_party({"azp": "https://app.hackmarket.example"})

    with pytest.raises(Unauthorized, match="authorized party"):
        auth_dependencies._validate_clerk_authorized_party({"azp": "https://attacker.example.com"})


@pytest.mark.parametrize("subject", [None, "", 123, ["clerk_user"]])
@pytest.mark.asyncio
async def test_verify_clerk_identity_rejects_invalid_subject(subject, monkeypatch):
    async def fake_get_jwks(jwks_url):
        return [{"kid": "kid_123"}]

    monkeypatch.setattr(
        auth_dependencies.settings,
        "clerk_jwks_url",
        "https://pleasing-racer-55.clerk.accounts.dev/.well-known/jwks.json",
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
    monkeypatch.setattr(
        auth_dependencies.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": subject},
    )

    with pytest.raises(Unauthorized, match="subject"):
        await auth_dependencies.verify_clerk_identity("fake-token")


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
        self.rollbacks = 0
        self.refreshed = []

    async def execute(self, statement):
        return _FakeAuthResult()

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def refresh(self, obj):
        self.refreshed.append(obj)


class _ExistingAuthSession(_FakeAuthSession):
    def __init__(self, user):
        super().__init__()
        self.user = user
        self.execute_calls = 0

    async def execute(self, statement):
        self.execute_calls += 1
        return _FakeAuthResult(self.user)


class _SequenceAuthSession(_FakeAuthSession):
    def __init__(self, results, commit_error=None):
        super().__init__()
        self.results = list(results)
        self.commit_error = commit_error

    async def execute(self, statement):
        return _FakeAuthResult(self.results.pop(0))

    async def commit(self):
        self.commits += 1
        if self.commit_error is not None:
            raise self.commit_error


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
async def test_sync_user_normalizes_verified_email():
    db = _FakeAuthSession()
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_normalized_email",
        email="  User.Name@Example.COM ",
        username="normalized-user",
        display_name="Normalized User",
    )

    user = await auth_service.sync_user_from_identity(db, identity)

    assert user.email == "user.name@example.com"


@pytest.mark.asyncio
async def test_sync_user_rejects_email_owned_by_another_clerk_account(buyer):
    db = _SequenceAuthSession([None, buyer])
    identity = auth_service.AuthIdentity(
        clerk_id="clerk_different_account",
        email=f"  {buyer.email.upper()}  ",
        username="different-account",
    )

    with pytest.raises(auth_service.AccountSyncConflictError, match="already linked"):
        await auth_service.sync_user_from_identity(db, identity)

    assert db.added == []
    assert db.commits == 0


@pytest.mark.asyncio
async def test_sync_user_returns_account_created_by_concurrent_request(buyer):
    buyer.clerk_id = "clerk_concurrent"
    db = _SequenceAuthSession(
        [None, None, None, buyer],
        commit_error=IntegrityError("insert user", {}, Exception("unique violation")),
    )
    identity = auth_service.AuthIdentity(
        clerk_id=buyer.clerk_id,
        email=buyer.email,
        username=buyer.username,
    )

    user = await auth_service.sync_user_from_identity(db, identity)

    assert user is buyer
    assert db.commits == 1
    assert db.rollbacks == 1


@pytest.mark.asyncio
async def test_sync_user_rejects_existing_account_email_change_conflict(buyer, seller):
    db = _SequenceAuthSession([buyer, seller])
    identity = auth_service.AuthIdentity(
        clerk_id=buyer.clerk_id,
        email=seller.email,
        username=buyer.username,
    )

    with pytest.raises(auth_service.AccountSyncConflictError, match="already linked"):
        await auth_service.sync_user_from_identity(db, identity)

    assert buyer.email != seller.email
    assert db.commits == 0


@pytest.mark.asyncio
async def test_sync_user_marks_unresolved_update_race_as_retryable(buyer):
    db = _SequenceAuthSession(
        [buyer, buyer, buyer, buyer],
        commit_error=IntegrityError("update user", {}, Exception("unique violation")),
    )
    identity = auth_service.AuthIdentity(
        clerk_id=buyer.clerk_id,
        email=buyer.email,
        username=buyer.username,
    )

    with pytest.raises(auth_service.AccountSyncRetryError) as exc_info:
        await auth_service.sync_user_from_identity(db, identity)

    assert exc_info.value.details == {"retryable": True}
    assert db.rollbacks == 1


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
async def test_sync_user_does_not_reactivate_suspended_account(buyer):
    buyer.is_active = False
    db = _ExistingAuthSession(buyer)
    identity = auth_service.AuthIdentity(
        clerk_id=buyer.clerk_id,
        email="updated@example.com",
        username=buyer.username,
        display_name="Updated Buyer",
    )

    user = await auth_service.sync_user_from_identity(db, identity)

    assert user is buyer
    assert user.email == "updated@example.com"
    assert user.display_name == "Updated Buyer"
    assert user.is_active is False
    assert db.commits == 1


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


@pytest.mark.asyncio
async def test_get_current_user_rejects_suspended_account_without_resync(buyer, monkeypatch):
    buyer.is_active = False
    db = _ExistingAuthSession(buyer)

    async def fake_verify_clerk_identity(token):
        assert token == "test-token"
        return auth_service.AuthIdentity(
            clerk_id=buyer.clerk_id,
            email=buyer.email,
            username=buyer.username,
        )

    async def fail_sync(*args, **kwargs):
        raise AssertionError("Suspended accounts must not be synchronized back to active.")

    monkeypatch.setattr(auth_dependencies, "verify_clerk_identity", fake_verify_clerk_identity)
    monkeypatch.setattr(auth_dependencies, "sync_user_from_identity", fail_sync)

    with pytest.raises(Unauthorized, match="suspended"):
        await auth_dependencies.get_current_user(db=db, authorization="Bearer test-token")

    assert db.commits == 0
