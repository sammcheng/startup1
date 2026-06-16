"""Tests for the internal converter import endpoint."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.dependencies import get_db, get_redis
from app.main import app
from app.routers import internal
from app.routers.internal import _verify_converter_secret
from tests.conftest import FakeAsyncSession, FakeRedis


VALID_PAYLOAD = {
    "repo_url": "https://github.com/test/repo",
    "repo_name": "test-repo",
    "language": "Python",
    "description": "A test repository",
    "endpoints": [
        {
            "method": "POST",
            "path": "/api/chat",
            "summary": "Chat endpoint",
            "request_body": {"message": "string — user message"},
            "response_example": {"reply": "Hello!"},
        }
    ],
    "setup_notes": "",
}


def test_converter_secret_dependency_rejects_when_unconfigured(monkeypatch):
    monkeypatch.setattr(internal.settings, "converter_secret", "")

    with pytest.raises(HTTPException) as exc:
        _verify_converter_secret("anything")

    assert exc.value.status_code == 503


def test_converter_secret_dependency_rejects_wrong_secret(monkeypatch):
    monkeypatch.setattr(internal.settings, "converter_secret", "expected-secret")

    with pytest.raises(HTTPException) as exc:
        _verify_converter_secret("wrong-secret")

    assert exc.value.status_code == 401


def test_converter_secret_dependency_accepts_matching_secret(monkeypatch):
    monkeypatch.setattr(internal.settings, "converter_secret", "expected-secret")

    assert _verify_converter_secret("expected-secret") is None


@pytest.fixture
def client_with_secret(fake_db, fake_redis, monkeypatch):
    monkeypatch.setenv("CONVERTER_SECRET", "test-secret")

    from app.config import settings
    monkeypatch.setattr(settings, "converter_secret", "test-secret")

    async def override_db():
        return fake_db

    async def override_redis():
        return fake_redis

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_redis] = override_redis
    app.dependency_overrides[_verify_converter_secret] = lambda: None

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_import_missing_secret_rejected(fake_db, fake_redis):
    async def override_db():
        return fake_db

    async def override_redis():
        return fake_redis

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_redis] = override_redis

    with TestClient(app) as c:
        resp = c.post("/v1/internal/tools/import", json=VALID_PAYLOAD)

    app.dependency_overrides.clear()
    assert resp.status_code in (401, 503)


def test_import_creates_tool(client_with_secret, fake_db, fake_redis):
    created_tool_id = uuid.uuid4()

    mock_tool = type("Tool", (), {
        "id": created_tool_id,
        "slug": "test-repo",
        "seller_id": uuid.uuid4(),
        "status": "live",
    })()

    with (
        patch("app.routers.internal._get_or_create_system_seller", new=AsyncMock(return_value=type("User", (), {"id": uuid.uuid4(), "role": "both"})())),
        patch("app.routers.internal.tool_service.create_tool", new=AsyncMock(return_value=mock_tool)),
        patch("app.routers.internal.tool_service.update_tool", new=AsyncMock(return_value=mock_tool)),
    ):
        resp = client_with_secret.post(
            "/v1/internal/tools/import",
            json=VALID_PAYLOAD,
            headers={"X-Converter-Secret": "test-secret"},
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "test-repo"
    assert "marketplace_url" in data
    assert "tool_id" in data


def test_import_with_multiple_endpoints(client_with_secret):
    payload = {**VALID_PAYLOAD, "endpoints": [
        {"method": "GET", "path": "/health", "summary": "Health check"},
        {"method": "POST", "path": "/analyze", "summary": "Analyze data",
         "request_body": {"text": "string — input text"},
         "response_example": {"result": "analysis output"}},
    ]}
    created_id = uuid.uuid4()
    mock_tool = type("Tool", (), {"id": created_id, "slug": "test-repo", "seller_id": uuid.uuid4(), "status": "live"})()

    with (
        patch("app.routers.internal._get_or_create_system_seller", new=AsyncMock(return_value=type("User", (), {"id": uuid.uuid4(), "role": "both"})())),
        patch("app.routers.internal.tool_service.create_tool", new=AsyncMock(return_value=mock_tool)),
        patch("app.routers.internal.tool_service.update_tool", new=AsyncMock(return_value=mock_tool)),
    ):
        resp = client_with_secret.post("/v1/internal/tools/import", json=payload)

    assert resp.status_code == 201
