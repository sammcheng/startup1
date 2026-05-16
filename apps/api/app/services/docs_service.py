import json
from typing import Any

from app.config import settings
from app.models.tool import InputType, OutputType, Tool
from app.schemas.docs import DocumentationCodeExample, DocumentationSection, ToolDocumentation

DEFAULT_RATE_LIMIT_PER_MINUTE = 100


def generate_tool_docs(tool: Tool, public_api_base_url: str | None = None) -> ToolDocumentation:
    endpoint_url = f"{_public_api_base(public_api_base_url)}/api/v1/tools/{tool.slug}"
    method = "POST"
    request_example = _build_request_example(tool)
    response_example = _build_response_example(tool)
    request_json = json.dumps(request_example, indent=2)
    response_json = json.dumps(response_example, indent=2)

    return ToolDocumentation(
        tool_id=tool.id,
        tool_slug=tool.slug,
        tool_name=tool.name,
        endpoint_url=endpoint_url,
        method=method,
        authentication=DocumentationSection(
            title="Authentication",
            body="Pass your API key in the X-API-Key header on every request. Keep this key server-side and rotate it from your dashboard if it is exposed.",
        ),
        request_format=DocumentationSection(
            title="Request",
            body=_request_format_body(tool, method),
        ),
        response_format=DocumentationSection(
            title="Response",
            body="Successful requests return a JSON response. The shape below is generated from the tool's configured output schema and example output.",
        ),
        rate_limit=DocumentationSection(
            title="Rate limits",
            body=f"Requests are currently limited to {DEFAULT_RATE_LIMIT_PER_MINUTE} requests per minute per API key. Response headers include X-RateLimit-Limit and X-RateLimit-Remaining so you can monitor usage in real time.",
        ),
        error_codes=[
            {"status": 401, "code": "INVALID_API_KEY", "meaning": "The X-API-Key header is missing, inactive, or invalid."},
            {"status": 404, "code": "TOOL_NOT_LIVE", "meaning": "The requested tool is unavailable, paused, or not live."},
            {"status": 429, "code": "RATE_LIMIT_EXCEEDED", "meaning": "The API key has exceeded its current request budget."},
            {"status": 502, "code": "TOOL_UNAVAILABLE", "meaning": "HackMarket could not reach the seller's tool container."},
        ],
        request_example=request_example,
        response_example=response_example,
        code_examples=[
            DocumentationCodeExample(language="curl", label="cURL", code=_curl_example(endpoint_url, request_json)),
            DocumentationCodeExample(language="python", label="Python", code=_python_example(endpoint_url, request_json)),
            DocumentationCodeExample(language="javascript", label="JavaScript", code=_javascript_example(endpoint_url, request_json)),
            DocumentationCodeExample(language="nodejs", label="Node.js", code=_nodejs_example(endpoint_url, request_json)),
        ],
    )


def _request_format_body(tool: Tool, method: str) -> str:
    base = f"Send a {method} request to the endpoint below with a JSON body that matches this tool's declared input schema."
    schema = tool.input_schema or {}
    fields = schema.get("fields")
    if not isinstance(fields, list):
        return base

    has_url = any(isinstance(field, dict) and str(field.get("name")) == "url" and str(field.get("type")) == "url" for field in fields)
    has_images = any(isinstance(field, dict) and str(field.get("name")) == "images" and str(field.get("type")) == "file" for field in fields)

    if has_url and has_images:
        return (
            f"{base} This tool accepts either a property listing URL or uploaded images. "
            "If the listing site blocks automated scraping, retry with uploaded photos for the most reliable result."
        )

    return base


def _build_request_example(tool: Tool) -> dict | list | str:
    schema = tool.input_schema or {}
    example = schema.get("example_input") or schema.get("example")
    if example is not None:
        return example

    fields = schema.get("fields")
    if isinstance(fields, list) and fields:
        payload: dict[str, Any] = {}
        for field in fields:
            if isinstance(field, dict):
                payload[str(field.get("name") or "field")] = _example_for_field(field)
        return payload

    return _example_from_input_type(tool.input_type)


def _build_response_example(tool: Tool) -> dict | list | str:
    schema = tool.output_schema or {}
    example = schema.get("example_output") or schema.get("example")
    if example is not None:
        return example

    fields = schema.get("fields")
    if isinstance(fields, list) and fields:
        payload: dict[str, Any] = {}
        for field in fields:
            if isinstance(field, dict):
                payload[str(field.get("name") or "result")] = _example_for_field(field)
        return payload

    return _example_from_output_type(tool.output_type)


def _example_for_field(field: dict[str, Any]) -> Any:
    if "example" in field:
        return field["example"]

    field_type = str(field.get("type") or "string").lower()
    if field_type == "number":
        return 42
    if field_type == "file":
        return "data:text/plain;base64,SGVsbG8sIEhhY2tNYXJrZXQ="
    if field_type == "url":
        return "https://example.com/resource"
    if field_type == "boolean":
        return True
    return "example-value"


def _example_from_input_type(input_type: InputType | None) -> dict | str:
    if input_type == InputType.text:
        return {"text": "Summarize this product review in one sentence."}
    if input_type == InputType.image:
        return {"image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"}
    if input_type == InputType.json:
        return {"input": {"message": "hello", "priority": 1}}
    if input_type == InputType.csv:
        return {"csv": "name,value\nalpha,10\nbeta,20"}
    if input_type == InputType.url:
        return {"url": "https://example.com/photo.jpg"}
    if input_type == InputType.file:
        return {"file": "data:text/plain;base64,SGVsbG8sIEhhY2tNYXJrZXQ="}
    return {"input": "example-value"}


def _example_from_output_type(output_type: OutputType | None) -> dict | str:
    if output_type == OutputType.text:
        return {"result": "This is the generated output."}
    if output_type == OutputType.image:
        return {"image_url": "https://cdn.hackmarket.io/example-output.png"}
    if output_type == OutputType.csv:
        return {"rows": [{"column_1": "value", "column_2": 42}]}
    if output_type == OutputType.file:
        return {"download_url": "https://cdn.hackmarket.io/generated-file.pdf"}
    return {"result": {"status": "ok", "data": {"message": "Success"}}}


def _public_api_base(public_api_base_url: str | None = None) -> str:
    if public_api_base_url:
        return public_api_base_url.rstrip("/")
    if settings.public_api_base_url:
        return settings.public_api_base_url.rstrip("/")
    return "http://localhost:8000"


def _curl_example(endpoint_url: str, request_json: str) -> str:
    body = _indent(request_json, 2)
    return (
        f"curl -X POST {endpoint_url} \\\n"
        '  -H "X-API-Key: your_api_key_here" \\\n'
        '  -H "Content-Type: application/json" \\\n'
        f"  -d '{body}'"
    )


def _python_example(endpoint_url: str, request_json: str) -> str:
    return f"""import requests

response = requests.post(
    "{endpoint_url}",
    headers={{"X-API-Key": "your_api_key_here"}},
    json={request_json},
    timeout=30,
)

response.raise_for_status()
result = response.json()
print(result)
"""


def _javascript_example(endpoint_url: str, request_json: str) -> str:
    return f"""const response = await fetch("{endpoint_url}", {{
  method: "POST",
  headers: {{
    "X-API-Key": "your_api_key_here",
    "Content-Type": "application/json",
  }},
  body: JSON.stringify({request_json}),
}});

if (!response.ok) {{
  throw new Error(`Request failed: ${{response.status}}`);
}}

const result = await response.json();
console.log(result);
"""


def _nodejs_example(endpoint_url: str, request_json: str) -> str:
    return f"""const axios = require("axios");

async function run() {{
  const response = await axios.post(
    "{endpoint_url}",
    {request_json},
    {{
      headers: {{
        "X-API-Key": "your_api_key_here",
        "Content-Type": "application/json",
      }},
      timeout: 30000,
    }}
  );

  console.log(response.data);
}}

run().catch((error) => {{
  console.error(error.response?.data || error.message);
}});
"""


def _indent(value: str, spaces: int) -> str:
    prefix = " " * spaces
    return value.replace("\n", f"\n{prefix}")
