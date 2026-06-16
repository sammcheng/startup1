import pytest

from app.exceptions import UploadFailedError
from app.services import storage_service


@pytest.mark.asyncio
async def test_local_storage_round_trip_stays_under_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service.settings, "s3_bucket_name", "")
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    monkeypatch.setattr(storage_service, "LOCAL_STORAGE_ROOT", tmp_path)

    await storage_service.upload_bytes("tools/tool-1/source.zip", b"hello", "application/zip")

    assert await storage_service.download_bytes("tools/tool-1/source.zip") == b"hello"
    assert (tmp_path / "tools" / "tool-1" / "source.zip").read_bytes() == b"hello"


@pytest.mark.asyncio
async def test_local_storage_rejects_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service.settings, "s3_bucket_name", "")
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    monkeypatch.setattr(storage_service, "LOCAL_STORAGE_ROOT", tmp_path)

    with pytest.raises(UploadFailedError, match="escape the storage root"):
        await storage_service.upload_bytes("../outside.txt", b"nope", "text/plain")

    assert not (tmp_path.parent / "outside.txt").exists()


@pytest.mark.asyncio
async def test_local_storage_rejects_empty_keys(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_service.settings, "s3_bucket_name", "")
    monkeypatch.setattr(storage_service.settings, "aws_access_key_id", "")
    monkeypatch.setattr(storage_service.settings, "aws_secret_access_key", "")
    monkeypatch.setattr(storage_service, "LOCAL_STORAGE_ROOT", tmp_path)

    with pytest.raises(UploadFailedError, match="cannot be empty"):
        await storage_service.upload_bytes("   ", b"nope", "text/plain")
