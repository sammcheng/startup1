import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db, require_seller
from app.exceptions import AppError, ToolNotFoundError, UploadFailedError
from app.models.tool import Tool, ToolStatus
from app.models.user import User
from app.schemas.tool import (
    ToolConfigureRequest,
    ToolResponse,
    ToolStatusResponse,
    ToolUpdate,
    ToolUploadGithubRequest,
    ToolUploadResponse,
)
from app.services import endpoint_service, job_service, storage_service, tool_service
from app.services.source_archive import SourceArchiveError, list_safe_zip_entries

router = APIRouter(prefix="/tools", tags=["tool-upload"])


async def _get_owned_tool(
    tool_id: uuid.UUID,
    current_user: Annotated[User, Depends(require_seller)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Tool:
    tool = await tool_service.get_tool_for_seller(db, tool_id, current_user.id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    return tool


@router.post(
    "/{tool_id}/upload",
    response_model=ToolUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload source code for a tool",
)
async def upload_tool_source(
    tool_id: uuid.UUID,
    request: Request,
    tool: Annotated[Tool, Depends(_get_owned_tool)],
    db: Annotated[AsyncSession, Depends(get_db)],
    source_zip: Annotated[UploadFile | None, File()] = None,
) -> ToolUploadResponse:
    content_type = request.headers.get("content-type", "")
    source_file_tree: list[str] | None = None

    if "multipart/form-data" in content_type:
        if source_zip is None:
            raise AppError(
                message="A zip file upload is required.",
                status_code=status.HTTP_400_BAD_REQUEST,
                error_code="source_required",
            )
        if not source_zip.filename or not source_zip.filename.lower().endswith(".zip"):
            raise AppError(
                message="Only zip uploads are supported.",
                status_code=status.HTTP_400_BAD_REQUEST,
                error_code="invalid_file",
            )

        file_bytes = await source_zip.read()
        if not file_bytes:
            raise AppError(
                message="The uploaded zip file was empty.",
                status_code=status.HTTP_400_BAD_REQUEST,
                error_code="invalid_file",
            )
        source_file_tree = _validate_and_list_zip_entries(file_bytes)
        source_s3_key = f"tools/{tool_id}/source.zip"
        await storage_service.upload_bytes(source_s3_key, file_bytes, "application/zip")

        should_start_processing = bool(tool.entry_command)
        updates = ToolUpdate(
            github_url=None,
            source_s3_key=source_s3_key,
            source_file_tree=source_file_tree,
            status=ToolStatus.processing if should_start_processing else ToolStatus.draft,
            processing_error=None,
        )
    else:
        try:
            payload = ToolUploadGithubRequest.model_validate(await request.json())
        except ValidationError as exc:
            raise AppError(
                message="The GitHub URL is invalid.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                error_code="invalid_github_url",
                details={"errors": exc.errors()},
            ) from exc
        source_file_tree = [_github_preview_label(payload.github_url)]
        should_start_processing = bool(tool.entry_command)
        updates = ToolUpdate(
            github_url=str(payload.github_url),
            source_s3_key=None,
            source_file_tree=source_file_tree,
            status=ToolStatus.processing if should_start_processing else ToolStatus.draft,
            processing_error=None,
        )

    updated = await tool_service.update_tool(db, tool, updates)
    job_id: uuid.UUID | None = None
    if should_start_processing:
        job = await _enqueue_processing_job(db, updated, trigger="source_upload")
        job_id = job.id

    return ToolUploadResponse(
        tool_id=updated.id,
        job_id=job_id,
        status=updated.status,
        status_url=f"/v1/tools/{tool_id}/status",
        source_file_tree=updated.source_file_tree,
    )


@router.post(
    "/{tool_id}/configure",
    response_model=ToolResponse,
    summary="Save tool runtime configuration",
)
async def configure_tool(
    tool_id: uuid.UUID,
    body: ToolConfigureRequest,
    tool: Annotated[Tool, Depends(_get_owned_tool)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ToolResponse:
    if not body.deployment_url and not body.entry_command:
        raise AppError(
            message="Provide either an entry command for Hackmarket to run or a live deployment URL.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            error_code="runtime_configuration_incomplete",
        )

    normalized_deployment_url = None
    if body.deployment_url:
        normalized_deployment_url = await endpoint_service.verify_live_endpoint(str(body.deployment_url))

    config_payload = body.model_dump()
    config_s3_key = f"tools/{tool_id}/config.json"
    await storage_service.upload_json(config_s3_key, config_payload)

    updated = await tool_service.update_tool(
        db,
        tool,
        ToolUpdate(
            input_schema=body.input_schema,
            output_schema=body.output_schema,
            environment_variables=[item.model_dump() for item in body.environment_variables],
            entry_command=body.entry_command,
            port=body.port,
            config_s3_key=config_s3_key,
            api_endpoint=normalized_deployment_url,
            status=ToolStatus.live if normalized_deployment_url else tool.status,
            processing_error=None,
        ),
    )
    if normalized_deployment_url:
        return ToolResponse.model_validate(updated)

    if updated.status in {ToolStatus.draft, ToolStatus.rejected} and (updated.source_s3_key or updated.github_url):
        updated = await tool_service.update_tool(
            db,
            updated,
            ToolUpdate(status=ToolStatus.processing, processing_error=None),
        )
        await _enqueue_processing_job(db, updated, trigger="runtime_configuration")
    return ToolResponse.model_validate(updated)


@router.get(
    "/{tool_id}/status",
    response_model=ToolStatusResponse,
    summary="Get tool processing status",
)
async def get_tool_status(
    tool_id: uuid.UUID,
    tool: Annotated[Tool, Depends(_get_owned_tool)],
) -> ToolStatusResponse:
    return ToolStatusResponse(
        tool_id=tool.id,
        status=tool.status,
        error_message=tool.processing_error,
        api_endpoint=tool.api_endpoint,
        source_file_tree=tool.source_file_tree,
    )


def _validate_and_list_zip_entries(file_bytes: bytes) -> list[str]:
    try:
        return list_safe_zip_entries(
            file_bytes,
            max_entries=settings.max_source_zip_entries,
            max_uncompressed_bytes=settings.max_source_zip_uncompressed_bytes,
        )
    except SourceArchiveError as exc:
        details = {"filename": exc.filename} if exc.filename else {}
        if "too many files" in str(exc):
            details["limit"] = settings.max_source_zip_entries
        if "allowed source size" in str(exc):
            details["limit"] = settings.max_source_zip_uncompressed_bytes
        raise UploadFailedError(str(exc), details=details) from exc


def _github_preview_label(github_url: str | object) -> str:
    repo_name = str(github_url).rstrip("/").split("/")[-1] or "repository"
    return f"{repo_name}/"


async def _enqueue_processing_job(db: AsyncSession, tool: Tool, *, trigger: str):
    try:
        return await job_service.enqueue_tool_processing(
            db,
            tool,
            trigger=trigger,
            payload={"tool_id": str(tool.id), "trigger": trigger},
        )
    except Exception as exc:
        tool.status = ToolStatus.rejected
        tool.processing_error = "The processing queue is unavailable. Please retry the upload or configuration step."
        await db.commit()
        raise AppError(
            message="We saved your source, but could not queue it for processing. Please try again in a moment.",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code="submission_queue_unavailable",
        ) from exc
