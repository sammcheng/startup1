from app.models.tool import ToolStatus
from app.routers import internal
from app.services import tool_service
from app.services import repo_analyzer


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


def test_get_my_tool(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(current_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_get_view_count(redis, slug):
        return 0

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "get_view_count", fake_get_view_count)

    response = client.get(f"/v1/tools/me/{draft_tool.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(draft_tool.id)


def test_get_my_tool_rejects_other_seller(client, auth_overrides, buyer, draft_tool, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.get(f"/v1/tools/me/{draft_tool.id}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


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


def test_update_processing_tool_rejected(client, auth_overrides, seller, live_tool, monkeypatch):
    auth_overrides(current_user=seller)
    live_tool.status = ToolStatus.processing

    async def fake_get_tool_by_id(db, tool_id):
        return live_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.put(f"/v1/tools/{live_tool.id}", json={"tagline": "Not yet"})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "tool_processing"


def test_delete_own_tool_pauses_it(client, auth_overrides, seller, live_tool, monkeypatch):
    auth_overrides(current_user=seller)
    paused = []

    async def fake_get_tool_by_id(db, tool_id):
        return live_tool

    async def fake_has_active_consumers(db, tool_id):
        return False

    async def fake_pause_tool(db, tool, redis=None):
        paused.append(tool.id)
        tool.status = ToolStatus.paused
        return tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "has_active_consumers", fake_has_active_consumers)
    monkeypatch.setattr(tool_service, "pause_tool", fake_pause_tool)

    response = client.delete(f"/v1/tools/{live_tool.id}")

    assert response.status_code == 204
    assert paused == [live_tool.id]
    assert live_tool.status == ToolStatus.paused


def test_delete_other_sellers_tool_rejected(client, auth_overrides, buyer, live_tool, monkeypatch):
    auth_overrides(current_user=buyer)

    async def fake_get_tool_by_id(db, tool_id):
        return live_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.delete(f"/v1/tools/{live_tool.id}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


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


def test_submit_repo_uses_signed_in_user_as_seller(client, auth_overrides, user, tool_factory, monkeypatch):
    auth_overrides(current_user=user)
    captured: dict[str, object] = {}

    async def fake_clone_repo(github_url, repo_path):
        captured["github_url"] = github_url
        captured["repo_path"] = str(repo_path)

    async def fake_analyze_repo(repo_path, github_url):
        return type(
            "Analysis",
            (),
            {
                "name": "Owned Draft",
                "description": "Authenticated submit flow.",
                "category": "Auth",
                "tool_category": "nlp",
                "tech_stack": ["TypeScript"],
                "input_contract": "Input",
                "output_contract": "Output",
                "complexity": "medium",
                "suggested_price_cents": 1200,
                "pricing_model": "buy",
            },
        )()

    async def fake_create_tool(db, seller_id, body):
        captured["seller_id"] = seller_id
        tool = tool_factory(seller=user, status=ToolStatus.draft, name=body.name, slug="owned-draft")
        tool.tagline = body.tagline
        tool.description = body.description
        tool.ownership_type = body.ownership_type
        tool.github_url = body.github_url
        tool.input_schema = body.input_schema
        tool.output_schema = body.output_schema
        tool.documentation = body.documentation
        return tool

    async def fake_system_seller(db):
        raise AssertionError("system seller should not be used for authenticated submissions")

    monkeypatch.setattr(repo_analyzer, "clone_repo", fake_clone_repo)
    monkeypatch.setattr(repo_analyzer, "analyze_repo", fake_analyze_repo)
    monkeypatch.setattr(tool_service, "create_tool", fake_create_tool)
    monkeypatch.setattr(internal, "_get_or_create_system_seller", fake_system_seller)

    response = client.post(
        "/v1/tools/submit",
        json={"github_url": "https://github.com/openai/example"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tool"]["seller_id"] == str(user.id)
    assert captured["seller_id"] == user.id
    assert "draft" in payload["message"].lower()
    assert "sign in" not in payload["message"].lower()


def test_submit_repo_anonymous_uses_system_seller(client, seller, tool_factory, monkeypatch):
    captured: dict[str, object] = {}

    async def fake_clone_repo(github_url, repo_path):
        captured["github_url"] = github_url
        captured["repo_path"] = str(repo_path)

    async def fake_analyze_repo(repo_path, github_url):
        return type(
            "Analysis",
            (),
            {
                "name": "Preview Draft",
                "description": "Anonymous preview flow.",
                "category": "Auth",
                "tool_category": "nlp",
                "tech_stack": ["Python"],
                "input_contract": "Input",
                "output_contract": "Output",
                "complexity": "low",
                "suggested_price_cents": 500,
                "pricing_model": "royalty",
            },
        )()

    async def fake_create_tool(db, seller_id, body):
        captured["seller_id"] = seller_id
        tool = tool_factory(seller=seller, status=ToolStatus.draft, name=body.name, slug="preview-draft")
        tool.tagline = body.tagline
        tool.description = body.description
        tool.ownership_type = body.ownership_type
        tool.github_url = body.github_url
        tool.input_schema = body.input_schema
        tool.output_schema = body.output_schema
        tool.documentation = body.documentation
        return tool

    async def fake_system_seller(db):
        return seller

    monkeypatch.setattr(repo_analyzer, "clone_repo", fake_clone_repo)
    monkeypatch.setattr(repo_analyzer, "analyze_repo", fake_analyze_repo)
    monkeypatch.setattr(tool_service, "create_tool", fake_create_tool)
    monkeypatch.setattr(internal, "_get_or_create_system_seller", fake_system_seller)

    response = client.post(
        "/v1/tools/submit",
        json={"github_url": "https://github.com/openai/example"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tool"]["seller_id"] == str(seller.id)
    assert captured["seller_id"] == seller.id
    assert "sign in" in payload["message"].lower()
    assert "account" in payload["message"].lower()


def test_submit_repo_production_requires_live_analysis(
    client, auth_overrides, user, monkeypatch
):
    auth_overrides(current_user=user)

    async def fake_clone_repo(github_url, repo_path):
        return None

    monkeypatch.setattr(repo_analyzer, "clone_repo", fake_clone_repo)
    monkeypatch.setattr(repo_analyzer.settings, "environment", "production")
    monkeypatch.setattr(repo_analyzer.settings, "openrouter_api_key", "")
    monkeypatch.setattr(repo_analyzer.settings, "allow_repo_analysis_fallback", False)

    response = client.post(
        "/v1/tools/submit",
        json={"github_url": "https://github.com/openai/example"},
    )

    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "repo_analysis_unavailable"
