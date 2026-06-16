from app.models.tool import ToolStatus
from app.services import tool_service


def test_admin_tools_requires_admin(client, auth_overrides, buyer):
    auth_overrides(current_user=buyer)

    response = client.get("/v1/admin/tools")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_admin_tools_lists_all_review_statuses(
    client,
    auth_overrides,
    admin_user,
    draft_tool,
    live_tool,
    monkeypatch,
):
    auth_overrides(current_user=admin_user)

    async def fake_list_admin_tools(db, status_filter, page, limit):
        assert status_filter is None
        assert page == 1
        assert limit == 50
        return [draft_tool, live_tool], 2

    async def fake_get_view_counts(redis, slugs):
        return {slug: 0 for slug in slugs}

    monkeypatch.setattr(tool_service, "list_admin_tools", fake_list_admin_tools)
    monkeypatch.setattr(tool_service, "get_view_counts", fake_get_view_counts)

    response = client.get("/v1/admin/tools")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert [item["status"] for item in payload["items"]] == ["draft", "live"]


def test_admin_review_updates_tool_status(
    client,
    auth_overrides,
    admin_user,
    draft_tool,
    monkeypatch,
):
    auth_overrides(current_user=admin_user)
    captured: dict[str, object] = {}

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool_review_status(
        db,
        tool,
        *,
        status,
        processing_error=None,
        is_featured=None,
        redis=None,
    ):
        captured["status"] = status
        captured["processing_error"] = processing_error
        captured["is_featured"] = is_featured
        tool.status = status
        tool.processing_error = processing_error
        tool.is_featured = bool(is_featured)
        return tool

    async def fake_get_view_count(redis, slug):
        return 0

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool_review_status", fake_update_tool_review_status)
    monkeypatch.setattr(tool_service, "get_view_count", fake_get_view_count)

    response = client.patch(
        f"/v1/admin/tools/{draft_tool.id}/review",
        json={
            "status": "rejected",
            "processing_error": "Needs clearer setup docs.",
            "is_featured": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert captured == {
        "status": ToolStatus.rejected,
        "processing_error": "Needs clearer setup docs.",
        "is_featured": False,
    }


def test_admin_review_rejects_live_without_endpoint(
    client,
    auth_overrides,
    admin_user,
    draft_tool,
    monkeypatch,
):
    auth_overrides(current_user=admin_user)
    draft_tool.api_endpoint = None

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.patch(
        f"/v1/admin/tools/{draft_tool.id}/review",
        json={"status": "live"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "tool_not_deployed"
