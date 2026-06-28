import pytest

from app.models import AdminAuditLog
from app.services import admin_audit_service


@pytest.mark.asyncio
async def test_record_admin_action_persists_audit_log(fake_db, admin_user, draft_tool):
    log = await admin_audit_service.record_admin_action(
        fake_db,
        admin_id=admin_user.id,
        action="tool_review_updated",
        target_type="tool",
        target_id=draft_tool.id,
        details={"status": "live"},
    )

    assert isinstance(log, AdminAuditLog)
    assert log.admin_id == admin_user.id
    assert log.action == "tool_review_updated"
    assert log.target_type == "tool"
    assert log.target_id == draft_tool.id
    assert log.details == {"status": "live"}
    assert fake_db.commits == 1
    assert fake_db.added == [log]
