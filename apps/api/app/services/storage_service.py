import asyncio
import json
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings
from app.exceptions import UploadFailedError


LOCAL_STORAGE_ROOT = Path(settings.local_storage_path)


def _use_s3() -> bool:
    return bool(
        settings.s3_bucket_name
        and settings.aws_access_key_id
        and settings.aws_secret_access_key
    )


def _local_path_for_key(key: str) -> Path:
    normalized = key.strip().lstrip("/")
    if not normalized:
        raise UploadFailedError("Storage key cannot be empty.")

    root = LOCAL_STORAGE_ROOT.resolve()
    path = (root / normalized).resolve()
    if path == root or root not in path.parents:
        raise UploadFailedError("Storage key cannot escape the storage root.")
    return path


async def _write_local_bytes(key: str, data: bytes) -> None:
    def _write() -> None:
        path = _local_path_for_key(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    try:
        await asyncio.to_thread(_write)
    except OSError as exc:
        raise UploadFailedError("Could not write uploaded files to local storage.") from exc


async def _read_local_bytes(key: str) -> bytes:
    def _read() -> bytes:
        path = _local_path_for_key(key)
        return path.read_bytes()

    try:
        return await asyncio.to_thread(_read)
    except OSError as exc:
        raise UploadFailedError("Could not read uploaded files from local storage.") from exc


_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
        )
    return _s3_client


async def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    if not _use_s3():
        await _write_local_bytes(key, data)
        return

    def _upload() -> None:
        client = _get_s3_client()
        client.put_object(
            Bucket=settings.s3_bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    for attempt in range(3):
        try:
            await asyncio.to_thread(_upload)
            return
        except (BotoCoreError, ClientError) as exc:
            if attempt == 2:
                raise UploadFailedError("Could not upload source to object storage.") from exc
            await asyncio.sleep(0.25 * (attempt + 1))


async def upload_json(key: str, payload: dict[str, Any]) -> None:
    await upload_bytes(
        key,
        json.dumps(payload, indent=2).encode("utf-8"),
        "application/json",
    )


async def download_bytes(key: str) -> bytes:
    if not _use_s3():
        return await _read_local_bytes(key)

    def _download() -> bytes:
        client = _get_s3_client()
        response = client.get_object(Bucket=settings.s3_bucket_name, Key=key)
        return response["Body"].read()

    for attempt in range(3):
        try:
            return await asyncio.to_thread(_download)
        except (BotoCoreError, ClientError) as exc:
            if attempt == 2:
                raise UploadFailedError("Could not download source from object storage.") from exc
            await asyncio.sleep(0.25 * (attempt + 1))
    raise UploadFailedError("Could not download source from object storage.")
