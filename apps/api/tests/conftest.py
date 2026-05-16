import os
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/hackmarket_test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_mock")
os.environ.setdefault("CLERK_JWKS_URL", "https://example.com/.well-known/jwks.json")

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("sqlalchemy")
pytest.importorskip("redis")
pytest.importorskip("stripe")
pytest.importorskip("jose")
pytest.importorskip("svix")
pytest.importorskip("pydantic_settings")

from app.dependencies import get_current_user, get_db, get_redis, require_seller, validate_api_key
from app.main import app
from app.models import APIKey, Tool, User
from app.models.tool import InputType, OutputType, OwnershipType, ToolCategory, ToolStatus
from app.models.user import UserRole


class FakeRedisPipeline:
    def __init__(self, redis: "FakeRedis") -> None:
        self.redis = redis
        self.commands: list[tuple[str, str]] = []

    async def __aenter__(self) -> "FakeRedisPipeline":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(self, key: str) -> None:
        self.commands.append(("get", key))

    async def execute(self) -> list[str | None]:
        results: list[str | None] = []
        for command, key in self.commands:
            if command == "get":
                results.append(await self.redis.get(key))
        return results


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, int | str] = {}

    async def incr(self, key: str) -> int:
        value = int(self.values.get(key, 0)) + 1
        self.values[key] = value
        return value

    async def expire(self, key: str, ttl: int) -> bool:
        return True

    async def get(self, key: str) -> str | None:
        value = self.values.get(key)
        return str(value) if value is not None else None

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.values[key] = value
        return True

    async def delete(self, key: str) -> int:
        self.values.pop(key, None)
        return 1

    def pipeline(self) -> FakeRedisPipeline:
        return FakeRedisPipeline(self)


class FakeAsyncSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.refreshed: list[Any] = []
        self.commits = 0

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    async def commit(self) -> None:
        self.commits += 1

    async def refresh(self, obj: Any) -> None:
        self.refreshed.append(obj)


def make_user(*, role: UserRole, email: str, username: str) -> User:
    return User(
        id=uuid.uuid4(),
        clerk_id=f"clerk_{username}",
        email=email,
        username=username,
        display_name=username.replace("_", " ").title(),
        role=role,
        is_active=True,
    )


def make_tool(*, seller: User, status: ToolStatus, name: str, slug: str) -> Tool:
    now = datetime.now(timezone.utc)
    tool = Tool(
        id=uuid.uuid4(),
        seller_id=seller.id,
        name=name,
        slug=slug,
        tagline=f"{name} tagline",
        description=f"{name} description",
        category=ToolCategory.nlp,
        status=status,
        ownership_type=OwnershipType.royalty,
        input_type=InputType.text,
        output_type=OutputType.json,
        input_schema={"fields": [{"name": "text", "type": "string", "required": True}]},
        output_schema={"fields": [{"name": "result", "type": "string"}]},
        price_per_request=Decimal("0.25"),
        port=8080,
        total_requests=0,
        is_featured=False,
        documentation=None,
        avg_response_time_ms=None,
        uptime_percentage=None,
        created_at=now,
        updated_at=now,
    )
    tool.seller = seller
    return tool


def make_api_key(*, user: User, is_active: bool = True) -> APIKey:
    return APIKey(
        id=uuid.uuid4(),
        user_id=user.id,
        key_hash="hashed-key",
        key_prefix="hm_live_abcd",
        name="production",
        is_active=is_active,
        created_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def user() -> User:
    return make_user(role=UserRole.both, email="user@example.com", username="user")


@pytest.fixture
def seller() -> User:
    return make_user(role=UserRole.seller, email="seller@example.com", username="seller")


@pytest.fixture
def buyer() -> User:
    return make_user(role=UserRole.buyer, email="buyer@example.com", username="buyer")


@pytest.fixture
def draft_tool(seller: User) -> Tool:
    return make_tool(seller=seller, status=ToolStatus.draft, name="Draft Tool", slug="draft-tool")


@pytest.fixture
def live_tool(seller: User) -> Tool:
    tool = make_tool(seller=seller, status=ToolStatus.live, name="Live Tool", slug="live-tool")
    tool.api_endpoint = "http://localhost:9001"
    return tool


@pytest.fixture
def api_key(buyer: User) -> APIKey:
    return make_api_key(user=buyer, is_active=True)


@pytest.fixture
def tool_factory():
    return make_tool


@pytest.fixture
def api_key_factory():
    return make_api_key


@pytest.fixture
def fake_db() -> FakeAsyncSession:
    return FakeAsyncSession()


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


@pytest.fixture
def mock_stripe(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    calls: list[dict[str, Any]] = []

    async def fake_call(func, *args, **kwargs):
        calls.append({"func": getattr(func, "__name__", "unknown"), "args": args, "kwargs": kwargs})
        if getattr(func, "__name__", "") == "create":
            return {"id": "obj_test"}
        return {"id": "obj_test", "status": "paid", "payment_intent": "pi_test", "data": []}

    return SimpleNamespace(calls=calls, fake_call=fake_call)


@pytest.fixture
def mock_s3() -> SimpleNamespace:
    storage: dict[str, bytes] = {}
    return SimpleNamespace(storage=storage)


@pytest.fixture
def mock_docker() -> SimpleNamespace:
    commands: list[tuple[str, ...]] = []
    return SimpleNamespace(commands=commands)


@pytest.fixture
def client(fake_db: FakeAsyncSession, fake_redis: FakeRedis) -> AsyncIterator[TestClient]:
    async def override_db():
        return fake_db

    async def override_redis():
        return fake_redis

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_redis] = override_redis

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def override_seller_auth(seller: User):
    async def _override() -> User:
        return seller

    return _override


def override_buyer_auth(buyer: User):
    async def _override() -> User:
        return buyer

    return _override


def override_api_key_auth(user: User, key: APIKey):
    async def _override() -> tuple[User, APIKey]:
        return user, key

    return _override


@pytest.fixture
def auth_overrides():
    def _apply(*, current_user: User | None = None, seller_user: User | None = None, api_key_context: tuple[User, APIKey] | None = None) -> None:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(require_seller, None)
        app.dependency_overrides.pop(validate_api_key, None)
        if current_user is not None:
            app.dependency_overrides[get_current_user] = override_buyer_auth(current_user)
        if seller_user is not None:
            app.dependency_overrides[require_seller] = override_seller_auth(seller_user)
        if api_key_context is not None:
            app.dependency_overrides[validate_api_key] = override_api_key_auth(*api_key_context)

    return _apply
