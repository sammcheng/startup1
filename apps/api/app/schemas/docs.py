import uuid
from typing import Literal

from pydantic import BaseModel


class DocumentationCodeExample(BaseModel):
    language: Literal["curl", "python", "javascript", "nodejs"]
    label: str
    code: str


class DocumentationSection(BaseModel):
    title: str
    body: str


class ToolDocumentation(BaseModel):
    tool_id: uuid.UUID
    tool_slug: str
    tool_name: str
    endpoint_url: str
    method: str
    authentication: DocumentationSection
    request_format: DocumentationSection
    response_format: DocumentationSection
    rate_limit: DocumentationSection
    error_codes: list[dict[str, str | int]]
    request_example: dict | list | str
    response_example: dict | list | str
    code_examples: list[DocumentationCodeExample]
