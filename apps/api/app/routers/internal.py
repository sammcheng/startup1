"""
Internal service-to-service endpoints.
Secured by CONVERTER_SECRET header — never exposed via Clerk auth.
Used by the converter service to register analyzed GitHub repos as draft tools.
"""
from __future__ import annotations

import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import get_db
from app.models.tool import OwnershipType, ToolCategory
from app.models.user import UserRole
from app.schemas.tool import ToolCreate
from app.services import tool_service
from app.services.auth_service import AuthIdentity, sync_user_from_identity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])

SYSTEM_SELLER_CLERK_ID = "system_converter_seller"
SYSTEM_SELLER_EMAIL = "converter@internal.hackmarket.io"


def _verify_converter_secret(x_converter_secret: Annotated[str | None, Header()] = None) -> None:
    if not settings.converter_secret:
        raise HTTPException(status_code=503, detail="Internal endpoints not configured.")
    if not x_converter_secret or not secrets.compare_digest(x_converter_secret, settings.converter_secret):
        raise HTTPException(status_code=401, detail="Invalid converter secret.")


class EndpointSpec(BaseModel):
    method: str
    path: str
    summary: str
    request_body: dict | None = None
    response_example: dict | None = None


class ConverterImportRequest(BaseModel):
    repo_url: str
    repo_name: str
    language: str
    description: str
    endpoints: list[EndpointSpec]
    setup_notes: str = ""


class ConverterImportResponse(BaseModel):
    tool_id: str
    slug: str
    marketplace_url: str


async def _get_or_create_system_seller(db: AsyncSession):
    identity = AuthIdentity(
        clerk_id=SYSTEM_SELLER_CLERK_ID,
        email=SYSTEM_SELLER_EMAIL,
        username="hackmarket-converter",
        display_name="Hackmarket Converter",
    )
    user = await sync_user_from_identity(db, identity)
    if user.role not in (UserRole.seller, UserRole.both, UserRole.admin):
        from sqlalchemy import update

        from app.models.user import User
        await db.execute(
            update(User)
            .where(User.id == user.id)
            .values(role=UserRole.both)
        )
        await db.commit()
        await db.refresh(user)
    return user


def _map_category(language: str) -> ToolCategory:
    lang = language.lower()
    if lang in ("python", "javascript", "typescript", "go", "rust", "java"):
        return ToolCategory.automation
    return ToolCategory.other


def _build_input_schema(endpoints: list[EndpointSpec]) -> dict:
    fields = []
    for ep in endpoints:
        if ep.request_body:
            for name, type_desc in ep.request_body.items():
                fields.append({"name": name, "type": "string", "description": type_desc, "required": False})
    return {"fields": fields} if fields else {"fields": [{"name": "input", "type": "string", "required": False}]}


def _build_output_schema(endpoints: list[EndpointSpec]) -> dict:
    for ep in endpoints:
        if ep.response_example:
            return {"example": ep.response_example}
    return {"fields": [{"name": "result", "type": "object"}]}


def _build_documentation(req: ConverterImportRequest) -> str:
    lines = [f"# {req.repo_name}\n", req.description, "\n## Endpoints\n"]
    for ep in req.endpoints:
        lines.append(f"### `{ep.method} {ep.path}`")
        lines.append(ep.summary)
        if ep.request_body:
            lines.append("\n**Request Body:**")
            for field, desc in ep.request_body.items():
                lines.append(f"- `{field}`: {desc}")
        if ep.response_example:
            import json
            lines.append("\n**Response Example:**")
            lines.append(f"```json\n{json.dumps(ep.response_example, indent=2)}\n```")
        lines.append("")
    if req.setup_notes:
        lines.append(f"\n## Setup Notes\n{req.setup_notes}")
    return "\n".join(lines)


@router.post(
    "/tools/import",
    response_model=ConverterImportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Import a converter-analyzed tool into the marketplace",
)
async def import_converter_tool(
    body: ConverterImportRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_verify_converter_secret),
) -> ConverterImportResponse:
    seller = await _get_or_create_system_seller(db)

    tool_data = ToolCreate(
        name=body.repo_name,
        tagline=body.description[:200] if len(body.description) > 200 else body.description,
        description=body.description,
        category=_map_category(body.language),
        ownership_type=OwnershipType.royalty,
        price_per_request=None,
        github_url=body.repo_url,
        input_schema=_build_input_schema(body.endpoints),
        output_schema=_build_output_schema(body.endpoints),
        documentation=_build_documentation(body),
    )

    # Converter imports are drafts until a real endpoint is configured or the
    # worker deploys the source. Public live tools must always be invokable.
    tool = await tool_service.create_tool(db, seller.id, tool_data)

    base = settings.public_api_base_url or "https://api.hackmarket.io/v1"
    marketplace_url = f"{base}/tools/{tool.slug}"

    logger.info("Converter imported tool %s (slug=%s) from %s", tool.id, tool.slug, body.repo_url)
    return ConverterImportResponse(
        tool_id=str(tool.id),
        slug=tool.slug,
        marketplace_url=marketplace_url,
    )
