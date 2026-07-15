import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.usage import UsageLogCreate
from app.services import usage_service


def make_entry() -> UsageLogCreate:
    return UsageLogCreate(
        api_key_id=uuid.uuid4(),
        tool_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        request_timestamp=datetime.now(UTC),
        response_time_ms=125,
        status_code=200,
        input_size_bytes=12,
        output_size_bytes=24,
        cost=Decimal("0.25"),
    )


class FakeUsageSession:
    def __init__(self, *, commit_error=None, existing=None):
        self.commit_error = commit_error
        self.existing = existing
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self):
        self.rollbacks += 1

    async def get(self, model, key):
        return self.existing


@pytest.mark.asyncio
async def test_persist_usage_log_writes_stable_id_once():
    db = FakeUsageSession()
    usage_log_id = uuid.uuid4()

    created = await usage_service.persist_usage_log(db, usage_log_id, make_entry())

    assert created is True
    assert db.added[0].id == usage_log_id
    assert db.commits == 1
    assert db.rollbacks == 0


@pytest.mark.asyncio
async def test_persist_usage_log_treats_existing_id_as_successful_retry():
    existing = object()
    db = FakeUsageSession(commit_error=RuntimeError("duplicate"), existing=existing)

    created = await usage_service.persist_usage_log(db, uuid.uuid4(), make_entry())

    assert created is False
    assert db.rollbacks == 1


@pytest.mark.asyncio
async def test_persist_usage_log_propagates_unrecoverable_failure():
    db = FakeUsageSession(commit_error=RuntimeError("database unavailable"))

    with pytest.raises(RuntimeError, match="database unavailable"):
        await usage_service.persist_usage_log(db, uuid.uuid4(), make_entry())

    assert db.rollbacks == 1
