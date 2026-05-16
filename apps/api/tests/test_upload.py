import io
import zipfile

from app.models.tool import ToolStatus
from app.services import container_service, endpoint_service, storage_service, tool_service


def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("app.py", "print('hello')")
    return buffer.getvalue()


def _apply_tool_updates(tool, updates):
    for key, value in updates.model_dump(exclude_unset=True).items():
        setattr(tool, key, value)
    return tool


def test_upload_waits_for_configuration(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    process_calls: list[str] = []

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_bytes(key, data, content_type):
        return None

    async def fake_process_tool_upload(tool_id):
        process_calls.append(str(tool_id))

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_bytes", fake_upload_bytes)
    monkeypatch.setattr(container_service, "process_tool_upload", fake_process_tool_upload)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes(), "application/zip")},
    )

    assert response.status_code == 202
    assert response.json()["status"] == ToolStatus.draft.value
    assert draft_tool.status == ToolStatus.draft
    assert process_calls == []


def test_configure_starts_processing_when_source_exists(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    process_calls: list[str] = []
    draft_tool.source_s3_key = f"tools/{draft_tool.id}/source.zip"
    draft_tool.status = ToolStatus.draft

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_json(key, payload):
        return None

    async def fake_process_tool_upload(tool_id):
        process_calls.append(str(tool_id))

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_json", fake_upload_json)
    monkeypatch.setattr(container_service, "process_tool_upload", fake_process_tool_upload)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/configure",
        json={
            "input_schema": {"fields": [{"name": "text", "type": "string", "required": True}]},
            "output_schema": {"type": "json", "properties": {"result": {"type": "string"}}},
            "environment_variables": [],
            "entry_command": "python app.py",
            "port": 8080,
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == ToolStatus.processing.value
    assert draft_tool.status == ToolStatus.processing
    assert process_calls == [str(draft_tool.id)]


def test_configure_with_deployed_api_goes_live(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    draft_tool.status = ToolStatus.draft

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_json(key, payload):
        return None

    async def fake_verify_live_endpoint(url):
        return "https://api.example.com"

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_json", fake_upload_json)
    monkeypatch.setattr(endpoint_service, "verify_live_endpoint", fake_verify_live_endpoint)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/configure",
        json={
            "input_schema": {"fields": [{"name": "text", "type": "string", "required": True}]},
            "output_schema": {"type": "json", "properties": {"result": {"type": "string"}}},
            "environment_variables": [],
            "entry_command": None,
            "port": 8080,
            "deployment_url": "https://api.example.com",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == ToolStatus.live.value
    assert draft_tool.status == ToolStatus.live
    assert draft_tool.api_endpoint == "https://api.example.com"
