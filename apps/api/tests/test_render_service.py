from __future__ import annotations

from app.config import settings
from app.services.container_service import ProjectAnalysis, ToolConfig
from app.services.render_service import (
    _build_image_service_payload,
    _build_service_payload,
    build_remote_image_uri,
    build_render_service_name,
    deploy_image_to_render,
    deploy_tool_to_render,
)


def test_build_render_service_name_is_stable(live_tool):
    service_name = build_render_service_name(live_tool)
    assert service_name.startswith("hm-tool-live-tool-")
    assert build_render_service_name(live_tool) == service_name


def test_build_service_payload_for_node_repo(monkeypatch, live_tool):
    live_tool.github_url = "https://github.com/example/vision-tool"
    monkeypatch.setattr(settings, "render_owner_id", "tea_test")
    monkeypatch.setattr(settings, "render_tool_plan", "starter")
    monkeypatch.setattr(settings, "render_tool_region", "oregon")
    monkeypatch.setattr(settings, "render_tool_auto_deploy", False)
    monkeypatch.setattr(settings, "render_tool_healthcheck_path", "/health")

    analysis = ProjectAnalysis(
        source_path="/tmp/source",
        language="node",
        framework="express",
        entry_point="server.js",
        port=3000,
        dependencies_file="package.json",
        has_dockerfile=False,
    )
    config = ToolConfig(
        entry_command="node server.js",
        port=3000,
        environment_variables={"OPENAI_API_KEY": "sk-test", "LOG_LEVEL": "info"},
    )

    payload = _build_service_payload(live_tool, analysis, config, "hm-tool-live")

    assert payload["type"] == "web_service"
    assert payload["ownerId"] == "tea_test"
    assert payload["repo"] == "https://github.com/example/vision-tool"
    assert payload["autoDeploy"] == "no"
    assert payload["serviceDetails"]["env"] == "node"
    assert payload["serviceDetails"]["buildCommand"] == "npm ci"
    assert payload["serviceDetails"]["startCommand"] == "node server.js"
    assert payload["serviceDetails"]["healthCheckPath"] == "/health"
    assert payload["envVars"] == [
        {"key": "LOG_LEVEL", "value": "info"},
        {"key": "OPENAI_API_KEY", "value": "sk-test"},
    ]


def test_build_remote_image_uri(monkeypatch, live_tool):
    monkeypatch.setattr(settings, "image_registry_namespace", "hackmarket")
    image_uri = build_remote_image_uri(live_tool)
    assert image_uri.startswith("ghcr.io/hackmarket/hackmarket-tools/live-tool:")


def test_build_image_service_payload(monkeypatch, live_tool):
    monkeypatch.setattr(settings, "render_owner_id", "tea_test")
    monkeypatch.setattr(settings, "render_tool_plan", "starter")
    monkeypatch.setattr(settings, "render_tool_region", "oregon")
    monkeypatch.setattr(settings, "render_tool_auto_deploy", False)
    monkeypatch.setattr(settings, "render_tool_healthcheck_path", "/health")
    live_tool.environment_variables = [{"key": "OPENAI_API_KEY", "value": "sk-test"}]

    payload = _build_image_service_payload(
        live_tool,
        "hm-tool-live",
        "ghcr.io/hackmarket/hackmarket-tools/live-tool:abc123",
        "regcred_123",
    )

    assert payload == {
        "type": "web_service",
        "ownerId": "tea_test",
        "name": "hm-tool-live",
        "autoDeploy": "no",
        "image": {
            "imagePath": "ghcr.io/hackmarket/hackmarket-tools/live-tool:abc123",
            "registryCredentialId": "regcred_123",
        },
        "envVars": [{"key": "OPENAI_API_KEY", "value": "sk-test"}],
        "serviceDetails": {
            "runtime": "image",
            "plan": "starter",
            "region": "oregon",
            "healthCheckPath": "/health",
        },
    }


async def test_deploy_tool_to_render_requires_github_url(monkeypatch, live_tool):
    monkeypatch.setattr(settings, "render_api_key", "rndr_test")
    monkeypatch.setattr(settings, "render_owner_id", "tea_test")
    live_tool.github_url = None

    analysis = ProjectAnalysis(
        source_path="/tmp/source",
        language="python",
        framework="fastapi",
        entry_point="main.py",
        port=8000,
        dependencies_file="requirements.txt",
        has_dockerfile=False,
    )
    config = ToolConfig(
        entry_command="uvicorn main:app --host 0.0.0.0 --port $PORT",
        port=8000,
        environment_variables={},
    )

    try:
        await deploy_tool_to_render(live_tool, analysis, config)
    except RuntimeError as exc:
        assert "GitHub repository URL" in str(exc)
    else:
        raise AssertionError("Expected deploy_tool_to_render to reject missing github_url")


async def test_deploy_tool_to_render_updates_existing_service(monkeypatch, live_tool):
    monkeypatch.setattr(settings, "render_api_key", "rndr_test")
    monkeypatch.setattr(settings, "render_owner_id", "tea_test")
    monkeypatch.setattr(settings, "render_tool_plan", "free")
    monkeypatch.setattr(settings, "render_tool_region", "oregon")
    monkeypatch.setattr(settings, "render_tool_auto_deploy", False)
    monkeypatch.setattr(settings, "render_tool_healthcheck_path", "/health")

    live_tool.github_url = "https://github.com/example/vision-tool"
    analysis = ProjectAnalysis(
        source_path="/tmp/source",
        language="python",
        framework="fastapi",
        entry_point="main.py",
        port=8000,
        dependencies_file="requirements.txt",
        has_dockerfile=False,
    )
    config = ToolConfig(
        entry_command="uvicorn main:app --host 0.0.0.0 --port $PORT",
        port=8000,
        environment_variables={"OPENAI_API_KEY": "sk-test"},
    )

    calls: list[tuple[str, str, dict | None]] = []

    async def fake_find_service_by_name(service_name: str):
        assert service_name.startswith("hm-tool-live-tool-")
        return {"id": "srv_existing", "name": service_name}

    async def fake_render_request(method: str, path: str, *, json=None, params=None):
        calls.append((method, path, json))
        return {"id": "srv_existing"}

    async def fake_wait_for_service_url(service_id: str) -> str:
        assert service_id == "srv_existing"
        return "https://hm-tool-live-tool.onrender.com"

    monkeypatch.setattr(
        "app.services.render_service._find_service_by_name", fake_find_service_by_name
    )
    monkeypatch.setattr("app.services.render_service._render_request", fake_render_request)
    monkeypatch.setattr(
        "app.services.render_service._wait_for_service_url", fake_wait_for_service_url
    )

    url = await deploy_tool_to_render(live_tool, analysis, config)

    assert url == "https://hm-tool-live-tool.onrender.com"
    assert calls == [
        (
            "PATCH",
            "/services/srv_existing",
            {
                "type": "web_service",
                "name": build_render_service_name(live_tool),
                "repo": "https://github.com/example/vision-tool",
                "autoDeploy": "no",
                "envVars": [{"key": "OPENAI_API_KEY", "value": "sk-test"}],
                "serviceDetails": {
                    "plan": "free",
                    "region": "oregon",
                    "healthCheckPath": "/health",
                    "env": "python",
                    "buildCommand": "pip install --no-cache-dir -r requirements.txt",
                    "startCommand": "uvicorn main:app --host 0.0.0.0 --port $PORT",
                },
            },
        ),
        ("POST", "/services/srv_existing/deploys", {"clearCache": "do_not_clear"}),
    ]


async def test_deploy_image_to_render_updates_existing_service(monkeypatch, live_tool):
    monkeypatch.setattr(settings, "render_api_key", "rndr_test")
    monkeypatch.setattr(settings, "render_owner_id", "tea_test")
    monkeypatch.setattr(settings, "render_tool_plan", "free")
    monkeypatch.setattr(settings, "render_tool_region", "oregon")
    monkeypatch.setattr(settings, "render_tool_auto_deploy", False)
    monkeypatch.setattr(settings, "render_tool_healthcheck_path", "/health")
    monkeypatch.setattr(settings, "image_registry_namespace", "hackmarket")
    monkeypatch.setattr(settings, "ghcr_username", "bot")
    monkeypatch.setattr(settings, "ghcr_token", "ghp_test")
    live_tool.environment_variables = [{"key": "OPENAI_API_KEY", "value": "sk-test"}]

    calls: list[tuple[str, str, dict | None]] = []

    async def fake_find_service_by_name(service_name: str):
        assert service_name.startswith("hm-tool-live-tool-")
        return {"id": "srv_existing", "name": service_name}

    async def fake_publish_image(local_image_uri: str, remote_image_uri: str):
        assert local_image_uri == "hackmarket/tool:latest"
        assert remote_image_uri.startswith("ghcr.io/hackmarket/hackmarket-tools/live-tool:")

    async def fake_registry_credential() -> str:
        return "regcred_123"

    async def fake_render_request(method: str, path: str, *, json=None, params=None):
        calls.append((method, path, json))
        return {"id": "srv_existing"}

    async def fake_wait_for_service_url(service_id: str) -> str:
        assert service_id == "srv_existing"
        return "https://hm-tool-live-tool.onrender.com"

    monkeypatch.setattr(
        "app.services.render_service._find_service_by_name", fake_find_service_by_name
    )
    monkeypatch.setattr("app.services.render_service._publish_image_to_ghcr", fake_publish_image)
    monkeypatch.setattr(
        "app.services.render_service.ensure_registry_credential", fake_registry_credential
    )
    monkeypatch.setattr("app.services.render_service._render_request", fake_render_request)
    monkeypatch.setattr(
        "app.services.render_service._wait_for_service_url", fake_wait_for_service_url
    )

    url = await deploy_image_to_render(live_tool, "hackmarket/tool:latest")

    assert url == "https://hm-tool-live-tool.onrender.com"
    assert calls[0][0:2] == ("PATCH", "/services/srv_existing")
    assert calls[0][2]["image"]["registryCredentialId"] == "regcred_123"
    assert calls[0][2]["serviceDetails"]["runtime"] == "image"
    assert calls[1] == ("POST", "/services/srv_existing/deploys", {"clearCache": "do_not_clear"})
