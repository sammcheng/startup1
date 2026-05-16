from app.models.tool import ToolStatus
from app.services import tool_service


def test_create_tool(client, auth_overrides, seller, tool_factory, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_create_tool_impl(db, seller_id, body):
        slug = body.name.lower().replace(" ", "-")
        tool = tool_factory(seller=seller, status=ToolStatus.draft, name=body.name, slug=slug)
        tool.tagline = body.tagline
        tool.description = body.description
        return tool

    monkeypatch.setattr(tool_service, "create_tool", fake_create_tool_impl)

    response = client.post(
        "/v1/tools",
        json={
            "name": "OCR Wizard",
            "tagline": "Reads receipts fast",
            "description": "Turns images into structured text.",
            "category": "nlp",
            "ownership_type": "royalty",
        },
    )

    assert response.status_code == 201
    assert response.json()["slug"] == "ocr-wizard"


def test_create_tool_unauthenticated(client):
    response = client.post(
        "/v1/tools",
        json={
            "name": "OCR Wizard",
            "tagline": "Reads receipts fast",
            "description": "Turns images into structured text.",
            "category": "nlp",
            "ownership_type": "royalty",
        },
    )

    assert response.status_code == 401


def test_list_tools_only_live(client, seller, live_tool, draft_tool, monkeypatch):
    async def fake_list_live_tools(db, filters, page, limit):
        items = [tool for tool in [live_tool, draft_tool] if tool.status == ToolStatus.live]
        return items, len(items)

    async def fake_get_view_counts(redis, slugs):
        return {slug: 0 for slug in slugs}

    monkeypatch.setattr(tool_service, "list_live_tools", fake_list_live_tools)
    monkeypatch.setattr(tool_service, "get_view_counts", fake_get_view_counts)

    response = client.get("/v1/tools")

    assert response.status_code == 200
    assert [item["slug"] for item in response.json()["items"]] == [live_tool.slug]


def test_search_tools(client, seller, live_tool, draft_tool, tool_factory, monkeypatch):
    other_live = tool_factory(seller=seller, status=ToolStatus.live, name="Image Labeler", slug="image-labeler")

    async def fake_list_live_tools(db, filters, page, limit):
        items = [tool for tool in [live_tool, other_live] if filters.search.lower() in tool.name.lower()]
        return items, len(items)

    async def fake_get_view_counts(redis, slugs):
        return {slug: 0 for slug in slugs}

    monkeypatch.setattr(tool_service, "list_live_tools", fake_list_live_tools)
    monkeypatch.setattr(tool_service, "get_view_counts", fake_get_view_counts)

    response = client.get("/v1/tools?search=Live")

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["slug"] == live_tool.slug


def test_update_own_tool(client, auth_overrides, seller, live_tool, monkeypatch):
    auth_overrides(current_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return live_tool

    async def fake_update_tool(db, tool, body, redis=None):
        tool.tagline = body.tagline or tool.tagline
        return tool

    async def fake_get_view_count(redis, slug):
        return 0

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(tool_service, "get_view_count", fake_get_view_count)

    response = client.put(f"/v1/tools/{live_tool.id}", json={"tagline": "Now even faster"})

    assert response.status_code == 200
    assert response.json()["tagline"] == "Now even faster"


def test_update_other_sellers_tool(client, auth_overrides, buyer, live_tool, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_get_tool_by_id(db, tool_id):
        return live_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.put(f"/v1/tools/{live_tool.id}", json={"tagline": "Malicious change"})

    assert response.status_code == 403


def test_duplicate_slug_handled(client, auth_overrides, seller, tool_factory, monkeypatch):
    auth_overrides(seller_user=seller)
    created_slugs: list[str] = []

    async def fake_create_tool(db, seller_id, body):
        base = body.name.lower().replace(" ", "-")
        slug = base if base not in created_slugs else f"{base}-2"
        created_slugs.append(slug)
        return tool_factory(seller=seller, status=ToolStatus.draft, name=body.name, slug=slug)

    monkeypatch.setattr(tool_service, "create_tool", fake_create_tool)

    payload = {
        "name": "Vision Agent",
        "tagline": "Analyzes screenshots",
        "description": "Turns pixels into insight.",
        "category": "computer_vision",
        "ownership_type": "royalty",
    }
    first = client.post("/v1/tools", json=payload)
    second = client.post("/v1/tools", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["slug"] == "vision-agent"
    assert second.json()["slug"] == "vision-agent-2"
