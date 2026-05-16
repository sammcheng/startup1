from __future__ import annotations

import asyncio
import logging
import re
import shutil
from typing import Any
from typing import TYPE_CHECKING

import httpx

from app.config import settings
from app.models import Tool
from app.services.proxy_service import get_http_client

if TYPE_CHECKING:
    from app.services.container_service import ProjectAnalysis, ToolConfig

logger = logging.getLogger(__name__)

RENDER_API_BASE = "https://api.render.com/v1"
ALLOWED_NATIVE_RUNTIMES = {"node", "python", "go", "rust"}


def render_deployments_enabled() -> bool:
    return bool(settings.render_api_key and settings.render_owner_id)


def render_image_deployments_enabled() -> bool:
    return bool(
        render_deployments_enabled()
        and settings.image_registry_namespace
        and settings.ghcr_username
        and settings.ghcr_token
    )


async def deploy_tool_to_render(tool: Tool, analysis: ProjectAnalysis, config: ToolConfig) -> str:
    if not render_deployments_enabled():
        raise RuntimeError(
            "Automatic Render deployments are not configured. Add RENDER_API_KEY and RENDER_OWNER_ID first."
        )
    if not tool.github_url:
        raise RuntimeError(
            "Automatic Render hosting currently requires a GitHub repository URL. Zip uploads still need a registry-backed deploy path."
        )

    service_name = build_render_service_name(tool)
    existing_service = await _find_service_by_name(service_name)
    payload = _build_service_payload(tool, analysis, config, service_name)

    if existing_service:
        service_id = _extract_service_id(existing_service)
        await _render_request("PATCH", f"/services/{service_id}", json=_patch_payload(payload))
        await _render_request(
            "POST",
            f"/services/{service_id}/deploys",
            json={"clearCache": "do_not_clear"},
        )
    else:
        created = await _render_request("POST", "/services", json=payload)
        service_id = _extract_service_id(created)

    return await _wait_for_service_url(service_id)


async def deploy_image_to_render(tool: Tool, local_image_uri: str) -> str:
    if not render_image_deployments_enabled():
        raise RuntimeError(
            "Image-backed Render hosting is not configured. Add IMAGE_REGISTRY_NAMESPACE, GHCR_USERNAME, and GHCR_TOKEN."
        )

    remote_image_uri = build_remote_image_uri(tool)
    await _publish_image_to_ghcr(local_image_uri, remote_image_uri)
    registry_credential_id = await ensure_registry_credential()

    service_name = build_render_service_name(tool)
    existing_service = await _find_service_by_name(service_name)
    payload = _build_image_service_payload(tool, service_name, remote_image_uri, registry_credential_id)

    if existing_service:
        service_id = _extract_service_id(existing_service)
        await _render_request("PATCH", f"/services/{service_id}", json=_patch_payload(payload))
        await _render_request(
            "POST",
            f"/services/{service_id}/deploys",
            json={"clearCache": "do_not_clear"},
        )
    else:
        created = await _render_request("POST", "/services", json=payload)
        service_id = _extract_service_id(created)

    return await _wait_for_service_url(service_id)


def build_render_service_name(tool: Tool) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", tool.slug.lower()).strip("-")
    slug = slug[:30] if slug else "tool"
    return f"hm-tool-{slug}-{str(tool.id).split('-')[0]}"


def _build_service_payload(
    tool: Tool,
    analysis: ProjectAnalysis,
    config: ToolConfig,
    service_name: str,
) -> dict[str, Any]:
    service_details = {
        "plan": settings.render_tool_plan,
        "region": settings.render_tool_region,
        "healthCheckPath": settings.render_tool_healthcheck_path,
    }

    env = _render_runtime_for_analysis(analysis)
    if env == "docker":
        service_details.update(
            {
                "env": "docker",
                "dockerContext": ".",
                "dockerfilePath": "./Dockerfile",
            }
        )
    else:
        service_details.update(
            {
                "env": env,
                "buildCommand": _build_command_for_analysis(analysis),
                "startCommand": config.entry_command,
            }
        )

    return {
        "type": "web_service",
        "ownerId": settings.render_owner_id,
        "name": service_name,
        "repo": tool.github_url,
        "autoDeploy": "yes" if settings.render_tool_auto_deploy else "no",
        "envVars": [{"key": key, "value": value} for key, value in sorted(config.environment_variables.items())],
        "serviceDetails": service_details,
    }


def _build_image_service_payload(
    tool: Tool,
    service_name: str,
    remote_image_uri: str,
    registry_credential_id: str,
) -> dict[str, Any]:
    environment_variables = getattr(tool, "environment_variables", None) or []
    return {
        "type": "web_service",
        "ownerId": settings.render_owner_id,
        "name": service_name,
        "autoDeploy": "yes" if settings.render_tool_auto_deploy else "no",
        "image": {
            "imagePath": remote_image_uri,
            "registryCredentialId": registry_credential_id,
        },
        "envVars": [
            {"key": item["key"], "value": item["value"]}
            for item in sorted(environment_variables, key=lambda item: item.get("key", ""))
            if item.get("key") and item.get("value") is not None
        ],
        "serviceDetails": {
            "runtime": "image",
            "plan": settings.render_tool_plan,
            "region": settings.render_tool_region,
            "healthCheckPath": settings.render_tool_healthcheck_path,
        },
    }


def _patch_payload(create_payload: dict[str, Any]) -> dict[str, Any]:
    payload = dict(create_payload)
    payload.pop("ownerId", None)
    return payload


def _render_runtime_for_analysis(analysis: ProjectAnalysis) -> str:
    if analysis.has_dockerfile:
        return "docker"
    if analysis.language not in ALLOWED_NATIVE_RUNTIMES:
        raise RuntimeError(
            f"Render auto-hosting only supports GitHub repos with Node, Python, Go, Rust, or an existing Dockerfile. Got '{analysis.language}'."
        )
    return analysis.language


def _build_command_for_analysis(analysis: ProjectAnalysis) -> str:
    if analysis.language == "node":
        return "npm ci"
    if analysis.language == "python":
        return "pip install --no-cache-dir ." if analysis.dependencies_file == "pyproject.toml" else "pip install --no-cache-dir -r requirements.txt"
    if analysis.language == "go":
        return "go build ./..."
    if analysis.language == "rust":
        return "cargo build --release"
    raise RuntimeError(f"Unsupported runtime '{analysis.language}' for Render deployment.")


def build_remote_image_uri(tool: Tool) -> str:
    namespace = settings.image_registry_namespace.strip().strip("/")
    if not namespace:
        raise RuntimeError("IMAGE_REGISTRY_NAMESPACE must be configured before pushing hosted tool images.")
    slug = re.sub(r"[^a-z0-9-]+", "-", tool.slug.lower()).strip("-")
    slug = slug[:50] if slug else "tool"
    tag = str(tool.id).replace("-", "")[:12]
    return f"ghcr.io/{namespace}/hackmarket-tools/{slug}:{tag}"


async def _find_service_by_name(service_name: str) -> dict[str, Any] | None:
    services = await _render_request("GET", "/services")
    if isinstance(services, list):
        candidates = services
    elif isinstance(services, dict):
        candidates = services.get("services") or services.get("items") or []
    else:
        candidates = []

    for service in candidates:
        if isinstance(service, dict) and service.get("name") == service_name:
            return service
    return None


async def ensure_registry_credential() -> str:
    if settings.render_registry_credential_id:
        return settings.render_registry_credential_id

    existing = await _find_registry_credential_by_name(settings.render_registry_credential_name)
    if existing:
        return existing

    created = await _render_request(
        "POST",
        "/registrycredentials",
        json={
            "ownerId": settings.render_owner_id,
            "registry": "GITHUB",
            "name": settings.render_registry_credential_name,
            "username": settings.ghcr_username,
            "authToken": settings.ghcr_token,
        },
    )
    return _extract_registry_credential_id(created)


async def _find_registry_credential_by_name(name: str) -> str | None:
    payload = await _render_request(
        "GET",
        "/registrycredentials",
        params={"ownerId": settings.render_owner_id, "name": [name]},
    )
    if isinstance(payload, list):
        candidates = payload
    elif isinstance(payload, dict):
        candidates = payload.get("items") or payload.get("registryCredentials") or []
    else:
        candidates = []

    for item in candidates:
        if isinstance(item, dict) and item.get("name") == name and isinstance(item.get("id"), str):
            return item["id"]
    return None


async def _wait_for_service_url(service_id: str) -> str:
    timeout_seconds = max(60, int(settings.render_tool_deploy_timeout_seconds))
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    last_url: str | None = None

    while loop.time() < deadline:
        service = await _render_request("GET", f"/services/{service_id}")
        service_url = _extract_service_url(service)
        if service_url:
            last_url = service_url
            if await _service_looks_healthy(service_url):
                return service_url
        await asyncio.sleep(10)

    if last_url:
        raise RuntimeError(
            f"Render accepted the deploy, but the service at {last_url} did not become healthy within {timeout_seconds} seconds."
        )
    raise RuntimeError("Render accepted the deploy, but no public service URL was provisioned.")


async def _service_looks_healthy(service_url: str) -> bool:
    client = get_http_client()
    candidates = [f"{service_url.rstrip('/')}/health", service_url]
    for url in candidates:
        try:
            response = await client.get(url, timeout=5)
            if response.status_code < 500:
                return True
        except httpx.HTTPError:
            continue
    return False


async def _publish_image_to_ghcr(local_image_uri: str, remote_image_uri: str) -> None:
    if not shutil.which("docker"):
        raise RuntimeError(
            "Docker is required to publish zip-upload images to GHCR, but docker is not available on this host."
        )

    await _run_command(
        [
            "docker",
            "login",
            "ghcr.io",
            "-u",
            settings.ghcr_username,
            "--password-stdin",
        ],
        input_bytes=settings.ghcr_token.encode("utf-8"),
        error_prefix="Docker login to GHCR failed",
    )
    await _run_command(
        ["docker", "tag", local_image_uri, remote_image_uri],
        error_prefix="Docker tag failed",
    )
    await _run_command(
        ["docker", "push", remote_image_uri],
        error_prefix="Docker push to GHCR failed",
    )


async def _run_command(command: list[str], *, input_bytes: bytes | None = None, error_prefix: str) -> None:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE if input_bytes is not None else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate(input=input_bytes)
    if process.returncode != 0:
        detail = (stderr or stdout).decode("utf-8", errors="ignore").strip()
        detail = detail.splitlines()[-1] if detail else "No details were returned."
        raise RuntimeError(f"{error_prefix}. {detail}")


async def _render_request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
) -> Any:
    client = get_http_client()
    headers = {
        "Authorization": f"Bearer {settings.render_api_key}",
        "Accept": "application/json",
    }
    if json is not None:
        headers["Content-Type"] = "application/json"

    response = await client.request(
        method,
        f"{RENDER_API_BASE}{path}",
        headers=headers,
        json=json,
        params=params,
        timeout=httpx.Timeout(connect=10, read=60, write=30, pool=30),
    )

    if response.is_success:
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError("Render returned a non-JSON response while provisioning the tool.") from exc

    detail = _extract_error_detail(response)
    raise RuntimeError(f"Render deployment failed. {detail}")


def _extract_service_id(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("id"), str):
        return payload["id"]
    nested = payload.get("service")
    if isinstance(nested, dict) and isinstance(nested.get("id"), str):
        return nested["id"]
    raise RuntimeError("Render created the service, but no service ID was returned.")


def _extract_registry_credential_id(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("id"), str):
        return payload["id"]
    nested = payload.get("registryCredential")
    if isinstance(nested, dict) and isinstance(nested.get("id"), str):
        return nested["id"]
    raise RuntimeError("Render created the registry credential, but no credential ID was returned.")


def _extract_service_url(payload: dict[str, Any]) -> str | None:
    if isinstance(payload.get("url"), str):
        return payload["url"]
    nested = payload.get("serviceDetails")
    if isinstance(nested, dict) and isinstance(nested.get("url"), str):
        return nested["url"]
    service = payload.get("service")
    if isinstance(service, dict):
        return _extract_service_url(service)
    return None


def _extract_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"

    if isinstance(payload, dict):
        for key in ("message", "error", "details"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        if "errors" in payload and isinstance(payload["errors"], list) and payload["errors"]:
            first = payload["errors"][0]
            if isinstance(first, dict):
                message = first.get("message") or first.get("detail")
                if isinstance(message, str) and message.strip():
                    return message.strip()
    return f"HTTP {response.status_code}"
