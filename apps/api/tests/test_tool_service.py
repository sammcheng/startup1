import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from app.models.tool import OwnershipType, ToolCategory
from app.schemas.tool import SellerToolUpdate, ToolCreate, ToolFilters
from app.services import discovery_service, tool_service


class ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


class CreateToolSession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, tool):
        self.added.append(tool)

    async def commit(self):
        self.commits += 1
        if self.commits == 1:
            raise IntegrityError(
                "insert into tools",
                {},
                Exception("duplicate key value violates unique constraint tools_slug_key"),
            )

    async def rollback(self):
        self.rollbacks += 1

    async def execute(self, query):
        return ScalarResult(self.added[-1])


class UpdateToolSession:
    def __init__(self, tool):
        self.tool = tool
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def execute(self, query):
        return ScalarResult(self.tool)


class QueryResult:
    def __init__(self, *, rows=None, scalar=0):
        self.rows = rows or []
        self.scalar = scalar

    def scalars(self):
        return self.rows

    def scalar_one(self):
        return self.scalar

    def one(self):
        return SimpleNamespace(
            live_tools=0,
            active_sellers=0,
            api_calls_served=0,
            avg_response_time_ms=None,
        )


class CapturingQuerySession:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return QueryResult()


def make_tool_create(name: str) -> ToolCreate:
    return ToolCreate(
        name=name,
        tagline="Production ready",
        description="A useful tool.",
        category=ToolCategory.automation,
        ownership_type=OwnershipType.royalty,
    )


def test_slugify_falls_back_when_name_has_no_slug_characters():
    assert tool_service._slugify("!!!") == "tool"


@pytest.mark.asyncio
async def test_create_tool_retries_after_slug_unique_race(monkeypatch):
    session = CreateToolSession()
    seller_id = uuid.uuid4()

    async def fake_find_unique_slug(db, base_slug):
        assert base_slug == "vision-agent"
        return base_slug

    async def fake_slug_exists(db, slug):
        return False

    monkeypatch.setattr(tool_service, "_find_unique_slug", fake_find_unique_slug)
    monkeypatch.setattr(tool_service, "_slug_exists", fake_slug_exists)

    tool = await tool_service.create_tool(session, seller_id, make_tool_create("Vision Agent"))

    assert tool.slug == "vision-agent-2"
    assert session.commits == 2
    assert session.rollbacks == 1
    assert [created.slug for created in session.added] == ["vision-agent", "vision-agent-2"]


@pytest.mark.asyncio
async def test_update_tool_keeps_only_the_active_price(draft_tool):
    draft_tool.price_per_request = Decimal("0.250000")
    draft_tool.one_time_price = Decimal("50.00")
    session = UpdateToolSession(draft_tool)

    updated = await tool_service.update_tool(
        session,
        draft_tool,
        SellerToolUpdate(
            ownership_type=OwnershipType.full_sale,
            one_time_price=Decimal("125.00"),
        ),
    )

    assert updated.ownership_type == OwnershipType.full_sale
    assert updated.one_time_price == Decimal("125.00")
    assert updated.price_per_request is None
    assert session.commits == 1


def test_effective_price_expression_includes_both_pricing_models():
    sql = str(
        tool_service._effective_price_expression().compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert "CASE" in sql
    assert "tools.one_time_price" in sql
    assert "tools.price_per_request" in sql


@pytest.mark.asyncio
async def test_marketplace_queries_require_an_active_seller():
    session = CapturingQuerySession()

    await tool_service.list_live_tools(session, ToolFilters(), page=1, limit=20)
    await discovery_service.discover_tools(session, query="", categories=None, limit=12)

    compiled = [
        str(
            statement.compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )
        for statement in session.statements
    ]
    assert len(compiled) == 3
    assert all("users.is_active IS true" in sql for sql in compiled)
    assert all("tools.status = 'live'" in sql for sql in compiled)


@pytest.mark.asyncio
async def test_marketplace_stats_are_derived_from_live_database_queries():
    session = CapturingQuerySession()

    stats = await tool_service.get_marketplace_stats(session)

    assert stats == {
        "live_tools": 0,
        "active_sellers": 0,
        "api_calls_served": 0,
        "avg_response_time_ms": None,
    }
    sql = str(
        session.statements[0].compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "users.is_active IS true" in sql
    assert "count(usage_logs.id)" in sql


@pytest.mark.asyncio
async def test_marketplace_stats_cache_avoids_repeated_database_scans(fake_redis, monkeypatch):
    calls = 0
    expected = {
        "live_tools": 12,
        "active_sellers": 7,
        "api_calls_served": 3456,
        "avg_response_time_ms": 87.4,
    }

    async def fake_get_marketplace_stats(db):
        nonlocal calls
        calls += 1
        return expected

    monkeypatch.setattr(tool_service, "get_marketplace_stats", fake_get_marketplace_stats)

    first = await tool_service.get_marketplace_stats_cached(object(), fake_redis)
    second = await tool_service.get_marketplace_stats_cached(object(), fake_redis)

    assert first == expected
    assert second == expected
    assert calls == 1
