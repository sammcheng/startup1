import io
import stat
import uuid
import zipfile
from datetime import UTC, datetime

from app.models import ToolProcessingJob, ToolProcessingJobStatus
from app.models.tool import ToolStatus
from app.services import endpoint_service, job_service, storage_service, tool_service


def _zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("app.py", "print('hello')")
    return buffer.getvalue()


def _zip_bytes_with_entries(entries: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def _zip_bytes_with_symlink(name: str = "app-link") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        info = zipfile.ZipInfo(name)
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "target")
    return buffer.getvalue()


def _apply_tool_updates(tool, updates):
    for key, value in updates.model_dump(exclude_unset=True).items():
        setattr(tool, key, value)
    return tool


def test_upload_waits_for_configuration(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    queue_calls: list[str] = []

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_bytes(key, data, content_type):
        return None

    async def fake_enqueue_tool_processing(db, tool, *, trigger, payload=None):
        queue_calls.append(f"{trigger}:{tool.id}")
        return type("QueuedJob", (), {"id": "job_queued"})()

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_bytes", fake_upload_bytes)
    monkeypatch.setattr(job_service, "enqueue_tool_processing", fake_enqueue_tool_processing)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes(), "application/zip")},
    )

    assert response.status_code == 202
    assert response.json()["status"] == ToolStatus.draft.value
    assert draft_tool.status == ToolStatus.draft
    assert queue_calls == []


def test_upload_queues_processing_when_runtime_is_configured(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    draft_tool.entry_command = "python app.py"
    queued_job_id = uuid.uuid4()
    queue_calls: list[str] = []

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_bytes(key, data, content_type):
        return None

    async def fake_enqueue_tool_processing(db, tool, *, trigger, payload=None):
        queue_calls.append(f"{trigger}:{tool.id}")
        return type("QueuedJob", (), {"id": queued_job_id})()

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_bytes", fake_upload_bytes)
    monkeypatch.setattr(job_service, "enqueue_tool_processing", fake_enqueue_tool_processing)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes(), "application/zip")},
    )

    assert response.status_code == 202
    assert response.json()["status"] == ToolStatus.processing.value
    assert response.json()["job_id"] == str(queued_job_id)
    assert queue_calls == [f"source_upload:{draft_tool.id}"]


def test_upload_rejects_zip_path_traversal(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_bytes(*args, **kwargs):
        raise AssertionError("unsafe archive should not be stored")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_bytes", fail_upload_bytes)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes_with_entries({"../secrets.env": "nope"}), "application/zip")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upload_failed"
    assert response.json()["error"]["message"] == "The uploaded zip contains an unsafe file path."


def test_upload_rejects_zip_windows_path_traversal(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_bytes(*args, **kwargs):
        raise AssertionError("unsafe archive should not be stored")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_bytes", fail_upload_bytes)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes_with_entries({"src\\..\\secrets.env": "nope"}), "application/zip")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upload_failed"
    assert response.json()["error"]["message"] == "The uploaded zip contains an unsafe file path."


def test_upload_rejects_zip_symlink(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_bytes(*args, **kwargs):
        raise AssertionError("unsafe archive should not be stored")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_bytes", fail_upload_bytes)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes_with_symlink(), "application/zip")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upload_failed"
    assert response.json()["error"]["message"] == "The uploaded zip contains a symbolic link, which is not supported."


def test_upload_rejects_zip_with_too_many_entries(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_bytes(*args, **kwargs):
        raise AssertionError("oversized archive should not be stored")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_bytes", fail_upload_bytes)
    monkeypatch.setattr("app.routers.upload.settings.max_source_zip_entries", 1)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={
            "source_zip": (
                "tool.zip",
                _zip_bytes_with_entries({"app.py": "print(1)", "worker.py": "print(2)"}),
                "application/zip",
            )
        },
    )

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "The uploaded zip contains too many files."
    assert response.json()["error"]["details"]["limit"] == 1


def test_upload_rejects_zip_with_large_uncompressed_size(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_bytes(*args, **kwargs):
        raise AssertionError("zip bomb should not be stored")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_bytes", fail_upload_bytes)
    monkeypatch.setattr("app.routers.upload.settings.max_source_zip_uncompressed_bytes", 4)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/upload",
        files={"source_zip": ("tool.zip", _zip_bytes_with_entries({"app.py": "print('large')"}), "application/zip")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "The uploaded zip expands beyond the allowed source size."
    assert response.json()["error"]["details"]["limit"] == 4


def test_configure_starts_processing_when_source_exists(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    queue_calls: list[str] = []
    draft_tool.source_s3_key = f"tools/{draft_tool.id}/source.zip"
    draft_tool.status = ToolStatus.draft

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_json(key, payload):
        return None

    async def fake_enqueue_tool_processing(db, tool, *, trigger, payload=None):
        queue_calls.append(f"{trigger}:{tool.id}")
        return type("QueuedJob", (), {"id": "job_queued"})()

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_json", fake_upload_json)
    monkeypatch.setattr(job_service, "enqueue_tool_processing", fake_enqueue_tool_processing)

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
    assert queue_calls == [f"runtime_configuration:{draft_tool.id}"]


def test_configure_marks_tool_rejected_when_queue_is_unavailable(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    draft_tool.source_s3_key = f"tools/{draft_tool.id}/source.zip"
    draft_tool.status = ToolStatus.draft

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_update_tool(db, tool, updates):
        return _apply_tool_updates(tool, updates)

    async def fake_upload_json(key, payload):
        return None

    async def fake_enqueue_tool_processing(db, tool, *, trigger, payload=None):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool", fake_update_tool)
    monkeypatch.setattr(storage_service, "upload_json", fake_upload_json)
    monkeypatch.setattr(job_service, "enqueue_tool_processing", fake_enqueue_tool_processing)

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

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "submission_queue_unavailable"
    assert draft_tool.status == ToolStatus.rejected


def test_configure_rejects_other_sellers_tool(client, auth_overrides, user, draft_tool, monkeypatch):
    auth_overrides(seller_user=user)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/configure",
        json={
            "input_schema": {},
            "output_schema": {},
            "environment_variables": [],
            "entry_command": "python app.py",
            "port": 8080,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_configure_requires_entry_command_or_deployment_url(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)

    response = client.post(
        f"/v1/tools/{draft_tool.id}/configure",
        json={
            "input_schema": {},
            "output_schema": {},
            "environment_variables": [],
            "port": 8080,
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "runtime_configuration_incomplete"


def test_seller_submission_status_returns_latest_processing_job(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)
    now = datetime.now(UTC)
    job = ToolProcessingJob(
        id=uuid.uuid4(),
        tool_id=draft_tool.id,
        seller_id=seller.id,
        status=ToolProcessingJobStatus.retrying,
        arq_job_id="tool-processing:test",
        trigger="source_upload",
        attempts=1,
        max_attempts=3,
        last_error="Render was temporarily unavailable.",
        created_at=now,
        updated_at=now,
    )

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fake_get_latest_tool_job(db, tool_id):
        return job

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(job_service, "get_latest_tool_job", fake_get_latest_tool_job)

    response = client.get(f"/v1/seller/submissions/{draft_tool.id}/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["tool"]["id"] == str(draft_tool.id)
    assert payload["job"]["status"] == "retrying"
    assert payload["job"]["last_error"] == "Render was temporarily unavailable."


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


def test_configure_rejects_local_deployment_url_in_production(client, auth_overrides, seller, draft_tool, monkeypatch):
    auth_overrides(seller_user=seller)

    async def fake_get_tool_by_id(db, tool_id):
        return draft_tool

    async def fail_upload_json(*args, **kwargs):
        raise AssertionError("unsafe endpoint should be rejected before storing config")

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(storage_service, "upload_json", fail_upload_json)
    monkeypatch.setattr("app.services.url_safety.settings.environment", "production")

    response = client.post(
        f"/v1/tools/{draft_tool.id}/configure",
        json={
            "input_schema": {},
            "output_schema": {},
            "environment_variables": [],
            "entry_command": None,
            "port": 8080,
            "deployment_url": "http://127.0.0.1:8080",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "insecure_deployment_url"
