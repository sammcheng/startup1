from urllib.parse import urlparse

import httpx

from app.exceptions import AppError
from app.services.proxy_service import get_http_client
from app.services.url_safety import validate_public_tool_endpoint


async def verify_live_endpoint(endpoint_url: str) -> str:
    normalized = validate_public_tool_endpoint(endpoint_url)
    parsed = urlparse(normalized)
    if not parsed.netloc:
        raise AppError(
            message="Enter a valid deployed API URL.",
            status_code=422,
            error_code="invalid_deployment_url",
        )

    client = get_http_client()
    candidates = [f"{normalized}/health", normalized]
    for candidate in candidates:
        try:
            response = await client.get(candidate, timeout=8, follow_redirects=True)
        except httpx.HTTPError:
            continue

        if response.status_code < 500:
            return normalized

    raise AppError(
        message="We couldn't reach that deployed API. Make sure it is live and publicly accessible.",
        status_code=422,
        error_code="deployment_unreachable",
    )
