import pytest

from app.dependencies import get_current_identity
from app.exceptions import Unauthorized
from app.main import app
from app.services import auth_service
import app.dependencies as auth_dependencies


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


def test_resolve_jwks_url_falls_back_to_issuer(monkeypatch):
    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(
        auth_dependencies.jwt,
        "get_unverified_claims",
        lambda token: {"iss": "https://cool-magpie-14.clerk.accounts.dev"},
    )

    jwks_url = auth_dependencies._resolve_jwks_url("fake-token")

    assert jwks_url == "https://cool-magpie-14.clerk.accounts.dev/.well-known/jwks.json"


def test_resolve_jwks_url_rejects_untrusted_issuer(monkeypatch):
    monkeypatch.setattr(auth_dependencies.settings, "clerk_jwks_url", "")
    monkeypatch.setattr(
        auth_dependencies.jwt,
        "get_unverified_claims",
        lambda token: {"iss": "https://attacker.example.com"},
    )

    with pytest.raises(Unauthorized):
        auth_dependencies._resolve_jwks_url("fake-token")
