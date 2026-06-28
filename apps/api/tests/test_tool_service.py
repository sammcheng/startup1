import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.tool import OwnershipType, ToolCategory
from app.schemas.tool import ToolCreate
from app.services import tool_service


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
            raise IntegrityError("insert into tools", {}, Exception("duplicate key value violates unique constraint tools_slug_key"))

    async def rollback(self):
        self.rollbacks += 1

    async def execute(self, query):
        return ScalarResult(self.added[-1])


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
