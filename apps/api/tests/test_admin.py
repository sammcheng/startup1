import uuid
from datetime import UTC, datetime

from app.models.admin_audit_log import AdminAuditLog
from app.models.tool import ToolStatus
from app.models.tool_processing_job import (
    ToolProcessingJob,
    ToolProcessingJobKind,
    ToolProcessingJobStatus,
)
from app.models.user import UserRole
from app.services import admin_audit_service, job_service, tool_service, user_service


def make_processing_job(draft_tool, *, status=ToolProcessingJobStatus.failed):
    now = datetime.now(UTC)
    job_id = uuid.uuid4()
    job = ToolProcessingJob(
        id=job_id,
        tool_id=draft_tool.id,
        seller_id=draft_tool.seller_id,
        kind=ToolProcessingJobKind.tool_upload,
        status=status,
        arq_job_id=f"tool-processing:{job_id}",
        trigger="upload",
        attempts=3,
        max_attempts=3,
        payload={"source": "test"},
        last_error="Build failed",
        created_at=now,
        updated_at=now,
    )
    job.tool = draft_tool
    job.seller = draft_tool.seller
    return job


def make_audit_log(admin_user, *, action="tool_review_updated", target_type="tool", target_id=None):
    now = datetime.now(UTC)
    log = AdminAuditLog(
        id=uuid.uuid4(),
        admin_id=admin_user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details={"status": "live"},
        created_at=now,
    )
    log.admin = admin_user
    return log


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
    audit_calls = []

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

    async def fake_record_admin_action(db, **kwargs):
        audit_calls.append(kwargs)

    monkeypatch.setattr(tool_service, "get_tool_by_id", fake_get_tool_by_id)
    monkeypatch.setattr(tool_service, "update_tool_review_status", fake_update_tool_review_status)
    monkeypatch.setattr(tool_service, "get_view_count", fake_get_view_count)
    monkeypatch.setattr(admin_audit_service, "record_admin_action", fake_record_admin_action)

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
    assert audit_calls[0]["action"] == "tool_review_updated"
    assert audit_calls[0]["target_id"] == draft_tool.id
    assert audit_calls[0]["details"] == {
        "previous": {
            "status": "draft",
            "is_featured": False,
            "processing_error": None,
        },
        "new": {
            "status": "rejected",
            "is_featured": False,
            "processing_error": "Needs clearer setup docs.",
        },
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


def test_admin_users_lists_accounts(client, auth_overrides, admin_user, buyer, monkeypatch):
    auth_overrides(current_user=admin_user)

    async def fake_list_admin_users(db, *, search, role_filter, is_active, page, limit):
        assert search == "buyer"
        assert role_filter == UserRole.buyer
        assert is_active is True
        assert page == 1
        assert limit == 50
        return [buyer], 1

    monkeypatch.setattr(user_service, "list_admin_users", fake_list_admin_users)

    response = client.get("/v1/admin/users?search=buyer&role=buyer&is_active=true")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["email"] == buyer.email
    assert payload["items"][0]["role"] == "buyer"


def test_admin_user_update_can_suspend_account(client, auth_overrides, admin_user, buyer, monkeypatch):
    auth_overrides(current_user=admin_user)
    captured: dict[str, object] = {}
    audit_calls = []

    async def fake_get_user_by_id(db, user_id):
        return buyer

    async def fake_update_user_admin_state(db, user, *, role=None, is_active=None):
        captured["role"] = role
        captured["is_active"] = is_active
        user.role = role or user.role
        user.is_active = bool(is_active)
        return user

    async def fake_record_admin_action(db, **kwargs):
        audit_calls.append(kwargs)

    monkeypatch.setattr(user_service, "get_user_by_id", fake_get_user_by_id)
    monkeypatch.setattr(user_service, "update_user_admin_state", fake_update_user_admin_state)
    monkeypatch.setattr(admin_audit_service, "record_admin_action", fake_record_admin_action)

    response = client.patch(
        f"/v1/admin/users/{buyer.id}",
        json={"role": "both", "is_active": False},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "both"
    assert response.json()["is_active"] is False
    assert captured == {"role": UserRole.both, "is_active": False}
    assert audit_calls[0]["action"] == "user_moderation_updated"
    assert audit_calls[0]["target_id"] == buyer.id
    assert audit_calls[0]["details"] == {
        "previous": {
            "role": "buyer",
            "is_active": True,
        },
        "new": {
            "role": "both",
            "is_active": False,
        },
    }


def test_admin_user_update_rejects_self_lockout(client, auth_overrides, admin_user, monkeypatch):
    auth_overrides(current_user=admin_user)

    async def fake_get_user_by_id(db, user_id):
        return admin_user

    monkeypatch.setattr(user_service, "get_user_by_id", fake_get_user_by_id)

    response = client.patch(
        f"/v1/admin/users/{admin_user.id}",
        json={"role": "buyer"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "admin_self_lockout"


def test_admin_processing_jobs_lists_failed_jobs(client, auth_overrides, admin_user, draft_tool, monkeypatch):
    auth_overrides(current_user=admin_user)
    failed_job = make_processing_job(draft_tool)

    async def fake_list_admin_processing_jobs(db, *, status_filter, tool_id, seller_id, page, limit):
        assert status_filter == ToolProcessingJobStatus.failed
        assert tool_id is None
        assert seller_id is None
        assert page == 1
        assert limit == 50
        return [failed_job], 1

    monkeypatch.setattr(job_service, "list_admin_processing_jobs", fake_list_admin_processing_jobs)

    response = client.get("/v1/admin/processing-jobs?status=failed")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["status"] == "failed"
    assert payload["items"][0]["tool_name"] == draft_tool.name
    assert payload["items"][0]["seller_email"] == draft_tool.seller.email


def test_admin_operations_health_returns_healthy_summary(client, auth_overrides, admin_user, fake_redis, monkeypatch):
    auth_overrides(current_user=admin_user)
    fake_redis.values["hackmarket:jobs:health"] = "1"

    async def fake_queue_depth(redis):
        return 2

    async def fake_processing_job_health(db):
        return {
            "stuck_active": 0,
            "failed_recent": 0,
            "stale_after_seconds": 1800,
            "failed_threshold": 3,
            "failed_window_seconds": 900,
        }

    monkeypatch.setattr("app.services.operations_health_service.job_service.processing_job_health", fake_processing_job_health)
    monkeypatch.setattr("app.services.operations_health_service.queue_service.queue_depth", fake_queue_depth)
    monkeypatch.setattr("app.services.operations_health_service.settings.alert_queue_depth_threshold", 100)

    response = client.get("/v1/admin/operations-health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "healthy"
    assert payload["checks"] == {"queue": "ok", "worker": "ok", "processing_jobs": "ok"}
    assert payload["queue"]["depth"] == 2
    assert payload["queue"]["worker_heartbeat"] is True
    assert payload["processing_jobs"]["stuck_active"] == 0


def test_admin_operations_health_returns_degraded_summary(client, auth_overrides, admin_user, fake_redis, monkeypatch):
    auth_overrides(current_user=admin_user)

    async def fake_queue_depth(redis):
        return 120

    async def fake_processing_job_health(db):
        return {
            "stuck_active": 1,
            "failed_recent": 4,
            "stale_after_seconds": 1800,
            "failed_threshold": 3,
            "failed_window_seconds": 900,
        }

    monkeypatch.setattr("app.services.operations_health_service.job_service.processing_job_health", fake_processing_job_health)
    monkeypatch.setattr("app.services.operations_health_service.queue_service.queue_depth", fake_queue_depth)
    monkeypatch.setattr("app.services.operations_health_service.settings.alert_queue_depth_threshold", 100)

    response = client.get("/v1/admin/operations-health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    assert payload["checks"]["queue"] == "degraded_high_depth"
    assert payload["checks"]["worker"] == "missing_heartbeat"
    assert payload["checks"]["processing_jobs"] == "degraded_stuck_active_and_failed_recent"
    assert payload["queue"]["depth"] == 120
    assert payload["processing_jobs"]["failed_recent"] == 4


def test_admin_audit_logs_lists_recent_actions(client, auth_overrides, admin_user, draft_tool, monkeypatch):
    auth_overrides(current_user=admin_user)
    audit_log = make_audit_log(admin_user, target_id=draft_tool.id)

    async def fake_list_admin_audit_logs(db, *, page, limit):
        assert page == 1
        assert limit == 50
        return [audit_log], 1

    monkeypatch.setattr(admin_audit_service, "list_admin_audit_logs", fake_list_admin_audit_logs)

    response = client.get("/v1/admin/audit-logs")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["action"] == "tool_review_updated"
    assert payload["items"][0]["admin_email"] == admin_user.email
    assert payload["items"][0]["target_id"] == str(draft_tool.id)


def test_admin_processing_job_retry_creates_new_job(client, auth_overrides, admin_user, draft_tool, monkeypatch):
    auth_overrides(current_user=admin_user)
    failed_job = make_processing_job(draft_tool)
    retry_job = make_processing_job(draft_tool, status=ToolProcessingJobStatus.queued)
    audit_calls = []

    async def fake_get_job_with_details(db, job_id):
        return retry_job if job_id == retry_job.id else failed_job

    async def fake_retry_failed_tool_processing_job(db, job, *, admin_id, reason):
        assert job == failed_job
        assert admin_id == admin_user.id
        assert reason == "Worker fixed"
        return retry_job

    async def fake_record_admin_action(db, **kwargs):
        audit_calls.append(kwargs)

    monkeypatch.setattr(job_service, "get_job_with_details", fake_get_job_with_details)
    monkeypatch.setattr(job_service, "retry_failed_tool_processing_job", fake_retry_failed_tool_processing_job)
    monkeypatch.setattr(admin_audit_service, "record_admin_action", fake_record_admin_action)

    response = client.post(
        f"/v1/admin/processing-jobs/{failed_job.id}/retry",
        json={"reason": "Worker fixed"},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert audit_calls[0]["action"] == "processing_job_retried"
    assert audit_calls[0]["target_id"] == failed_job.id
    assert audit_calls[0]["details"]["retry_job_id"] == str(retry_job.id)


def test_admin_processing_job_retry_rejects_active_job(client, auth_overrides, admin_user, draft_tool, monkeypatch):
    auth_overrides(current_user=admin_user)
    running_job = make_processing_job(draft_tool, status=ToolProcessingJobStatus.running)

    async def fake_get_job_with_details(db, job_id):
        return running_job

    monkeypatch.setattr(job_service, "get_job_with_details", fake_get_job_with_details)

    response = client.post(
        f"/v1/admin/processing-jobs/{running_job.id}/retry",
        json={"reason": "Try again"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "processing_job_not_retryable"
