import math
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db, get_redis, require_admin
from app.exceptions import AppError, ToolNotFoundError
from app.models.tool import ToolStatus
from app.models.tool_processing_job import ToolProcessingJob, ToolProcessingJobStatus
from app.models.user import User
from app.models.user import UserRole
from app.schemas.admin import (
    AdminOperationsHealthResponse,
    AdminProcessingJobListResponse,
    AdminProcessingJobResponse,
    AdminProcessingJobRetryRequest,
    AdminUserListResponse,
    AdminUserResponse,
    AdminUserUpdate,
)
from app.schemas.tool import AdminToolReviewUpdate, ToolListResponse, ToolResponse
from app.services import job_service, operations_health_service, tool_service, user_service

router = APIRouter(prefix="/admin", tags=["admin"])


def _job_response(job: ToolProcessingJob) -> AdminProcessingJobResponse:
    tool = getattr(job, "tool", None)
    seller = getattr(job, "seller", None)
    return AdminProcessingJobResponse(
        id=job.id,
        tool_id=job.tool_id,
        seller_id=job.seller_id,
        kind=job.kind,
        status=job.status,
        arq_job_id=job.arq_job_id,
        trigger=job.trigger,
        attempts=job.attempts,
        max_attempts=job.max_attempts,
        payload=job.payload,
        last_error=job.last_error,
        enqueued_at=job.enqueued_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
        tool_name=getattr(tool, "name", None),
        tool_slug=getattr(tool, "slug", None),
        tool_status=getattr(tool, "status", None),
        seller_email=getattr(seller, "email", None),
    )


@router.get(
    "/operations-health",
    response_model=AdminOperationsHealthResponse,
    summary="Inspect production operations health",
)
async def get_admin_operations_health(
    _admin: Annotated[User, Depends(require_admin)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> AdminOperationsHealthResponse:
    return AdminOperationsHealthResponse.model_validate(await operations_health_service.get_operations_health(db, redis))


@router.get(
    "/tools",
    response_model=ToolListResponse,
    summary="List tools visible to admin review",
)
async def list_admin_tools(
    _admin: Annotated[User, Depends(require_admin)],
    status_filter: ToolStatus | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolListResponse:
    tools, total = await tool_service.list_admin_tools(db, status_filter, page, limit)
    slugs = [tool.slug for tool in tools]
    views = await tool_service.get_view_counts(redis, slugs)

    return ToolListResponse(
        items=[
            ToolResponse.model_validate(tool).model_copy(update={"view_count": views.get(tool.slug, 0)})
            for tool in tools
        ],
        total=total,
        page=page,
        limit=limit,
        pages=math.ceil(total / limit) if total else 0,
    )


@router.patch(
    "/tools/{tool_id}/review",
    response_model=ToolResponse,
    summary="Apply an admin review decision to a tool",
)
async def update_admin_tool_review(
    tool_id: uuid.UUID,
    body: AdminToolReviewUpdate,
    _admin: Annotated[User, Depends(require_admin)],
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ToolResponse:
    tool = await tool_service.get_tool_by_id(db, tool_id)
    if not tool:
        raise ToolNotFoundError(str(tool_id))
    if body.status == ToolStatus.live and not tool.api_endpoint:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            error_code="tool_not_deployed",
            message="A tool must have a deployed API endpoint before it can be approved live.",
        )

    updated = await tool_service.update_tool_review_status(
        db,
        tool,
        status=ToolStatus(body.status),
        processing_error=body.processing_error,
        is_featured=body.is_featured,
        redis=redis,
    )
    view_count = await tool_service.get_view_count(redis, updated.slug)
    return ToolResponse.model_validate(updated).model_copy(update={"view_count": view_count})


@router.get(
    "/users",
    response_model=AdminUserListResponse,
    summary="List users for admin moderation",
)
async def list_admin_users(
    _admin: Annotated[User, Depends(require_admin)],
    search: str | None = Query(None, min_length=1, max_length=100),
    role_filter: UserRole | None = Query(None, alias="role"),
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> AdminUserListResponse:
    users, total = await user_service.list_admin_users(
        db,
        search=search,
        role_filter=role_filter,
        is_active=is_active,
        page=page,
        limit=limit,
    )
    return AdminUserListResponse(
        items=[AdminUserResponse.model_validate(user) for user in users],
        total=total,
        page=page,
        limit=limit,
        pages=math.ceil(total / limit) if total else 0,
    )


@router.patch(
    "/users/{user_id}",
    response_model=AdminUserResponse,
    summary="Update a user moderation state",
)
async def update_admin_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    admin: Annotated[User, Depends(require_admin)],
    db: AsyncSession = Depends(get_db),
) -> AdminUserResponse:
    user = await user_service.get_user_by_id(db, user_id)
    if not user:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="user_not_found",
            message="User not found.",
        )

    if user.id == admin.id and (body.is_active is False or body.role not in (None, UserRole.admin)):
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            error_code="admin_self_lockout",
            message="Admins cannot remove their own admin access or deactivate their own account.",
        )

    updated = await user_service.update_user_admin_state(
        db,
        user,
        role=body.role,
        is_active=body.is_active,
    )
    return AdminUserResponse.model_validate(updated)


@router.get(
    "/processing-jobs",
    response_model=AdminProcessingJobListResponse,
    summary="List durable processing jobs",
)
async def list_admin_processing_jobs(
    _admin: Annotated[User, Depends(require_admin)],
    status_filter: ToolProcessingJobStatus | None = Query(None, alias="status"),
    tool_id: uuid.UUID | None = Query(None),
    seller_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> AdminProcessingJobListResponse:
    jobs, total = await job_service.list_admin_processing_jobs(
        db,
        status_filter=status_filter,
        tool_id=tool_id,
        seller_id=seller_id,
        page=page,
        limit=limit,
    )
    return AdminProcessingJobListResponse(
        items=[_job_response(job) for job in jobs],
        total=total,
        page=page,
        limit=limit,
        pages=math.ceil(total / limit) if total else 0,
    )


@router.post(
    "/processing-jobs/{job_id}/retry",
    response_model=AdminProcessingJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Retry a failed processing job",
)
async def retry_admin_processing_job(
    job_id: uuid.UUID,
    body: AdminProcessingJobRetryRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: AsyncSession = Depends(get_db),
) -> AdminProcessingJobResponse:
    job = await job_service.get_job_with_details(db, job_id)
    if not job:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="processing_job_not_found",
            message="Processing job not found.",
        )
    if job.status != ToolProcessingJobStatus.failed:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            error_code="processing_job_not_retryable",
            message="Only failed processing jobs can be retried.",
        )

    try:
        retry_job = await job_service.retry_failed_tool_processing_job(
            db,
            job,
            admin_id=admin.id,
            reason=body.reason,
        )
    except ValueError as exc:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            error_code="processing_job_retry_rejected",
            message=str(exc),
        ) from exc
    except Exception as exc:
        raise AppError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            error_code="processing_job_queue_unavailable",
            message="The processing queue is unavailable. Try again after the worker recovers.",
        ) from exc

    detailed_retry_job = await job_service.get_job_with_details(db, retry_job.id)
    return _job_response(detailed_retry_job or retry_job)
