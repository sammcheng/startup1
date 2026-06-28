#!/usr/bin/env python3
"""Fail fast when production launch assumptions drift.

This check is intentionally local and deterministic. It does not prove the live
Vercel or Render accounts are configured, but it does protect the repository
contract we expect those platforms to deploy from.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
RENDER_BLUEPRINT = REPO_ROOT / "render.yaml"
WEB_PACKAGE = REPO_ROOT / "apps" / "web" / "package.json"
API_REQUIREMENTS = REPO_ROOT / "apps" / "api" / "requirements.txt"
JOBS_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0007_add_tool_processing_jobs.py"
)
ENV_EXAMPLE = REPO_ROOT / ".env.example"


API_REQUIRED_ENV = {
    "ENVIRONMENT",
    "DEBUG",
    "APP_BASE_URL",
    "PUBLIC_API_BASE_URL",
    "CORS_ORIGINS",
    "CORS_ORIGIN_REGEX",
    "ALLOW_VERCEL_PREVIEW_ORIGINS",
    "DATABASE_URL",
    "REDIS_URL",
    "WORKER_QUEUE_NAME",
    "WORKER_JOB_MAX_ATTEMPTS",
    "WORKER_JOB_TIMEOUT_SECONDS",
    "WORKER_JOB_KEEP_RESULT_SECONDS",
    "WORKER_CONCURRENCY",
    "WORKER_HEALTH_CHECK_INTERVAL_SECONDS",
    "WORKER_HEALTH_CHECK_KEY",
    "RUN_BILLING_SCHEDULER_IN_API",
    "ALERT_WEBHOOK_URL",
    "ALERT_WEBHOOK_TIMEOUT_SECONDS",
    "ALERT_QUEUE_DEPTH_THRESHOLD",
    "CONVERTER_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SECRET",
    "CLERK_JWKS_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "S3_BUCKET_NAME",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_APP_URL",
    "OPENROUTER_APP_NAME",
    "ALLOW_REPO_ANALYSIS_FALLBACK",
    "OPENAI_API_KEY",
    "RENDER_API_KEY",
    "RENDER_OWNER_ID",
    "RENDER_TOOL_REGION",
    "RENDER_TOOL_PLAN",
    "RENDER_TOOL_AUTO_DEPLOY",
    "RENDER_TOOL_HEALTHCHECK_PATH",
    "RENDER_TOOL_DEPLOY_TIMEOUT_SECONDS",
    "RENDER_REGISTRY_CREDENTIAL_ID",
    "RENDER_REGISTRY_CREDENTIAL_NAME",
    "IMAGE_REGISTRY_NAMESPACE",
    "GHCR_USERNAME",
    "GHCR_TOKEN",
}


def load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    if not isinstance(data, dict):
        raise ValueError(f"{path} did not contain a YAML object")
    return data


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError(f"{path} did not contain a JSON object")
    return data


def service_by_name(blueprint: dict[str, Any], name: str) -> dict[str, Any] | None:
    for service in blueprint.get("services", []):
        if service.get("name") == name:
            return service
    return None


def database_by_name(blueprint: dict[str, Any], name: str) -> dict[str, Any] | None:
    for database in blueprint.get("databases", []):
        if database.get("name") == name:
            return database
    return None


def env_map(service: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        env_var["key"]: {key: value for key, value in env_var.items() if key != "key"}
        for env_var in service.get("envVars", [])
        if isinstance(env_var, dict) and "key" in env_var
    }


def expect(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def check_render_blueprint(failures: list[str]) -> None:
    blueprint = load_yaml(RENDER_BLUEPRINT)
    services = {service.get("name") for service in blueprint.get("services", [])}
    for required in {"start", "start-worker", "home-accessibility-checker", "hackmarket-redis"}:
        expect(required in services, f"render.yaml is missing service {required!r}", failures)

    api = service_by_name(blueprint, "start")
    worker = service_by_name(blueprint, "start-worker")
    redis = service_by_name(blueprint, "hackmarket-redis")
    seller_tool = service_by_name(blueprint, "home-accessibility-checker")
    database = database_by_name(blueprint, "hackmarket-db")

    for name, service in {
        "start": api,
        "start-worker": worker,
        "home-accessibility-checker": seller_tool,
        "hackmarket-redis": redis,
    }.items():
        if service is None:
            continue
        expect(service.get("plan") not in {None, "free"}, f"{name} must not use a free Render plan", failures)
        expect(
            service.get("autoDeployTrigger") == "checksPass" or service.get("type") == "keyvalue",
            f"{name} should auto-deploy only after checks pass",
            failures,
        )

    if database is None:
        failures.append("render.yaml is missing database 'hackmarket-db'")
    else:
        expect(
            database.get("plan") not in {None, "free"},
            "hackmarket-db must not use a free Render database plan",
            failures,
        )
        expect(database.get("ipAllowList") == [], "hackmarket-db should not expose public IP access", failures)

    for name, service in {"start": api, "start-worker": worker}.items():
        if service is None:
            continue
        env = env_map(service)
        missing = sorted(API_REQUIRED_ENV - set(env))
        expect(not missing, f"{name} is missing env vars: {', '.join(missing)}", failures)
        expect(env.get("ENVIRONMENT", {}).get("value") == "production", f"{name} must run production env", failures)
        expect(env.get("DEBUG", {}).get("value") == "false", f"{name} must disable debug mode", failures)
        expect(
            env.get("RUN_BILLING_SCHEDULER_IN_API", {}).get("value") == "false",
            f"{name} must keep API billing scheduler disabled",
            failures,
        )
        expect(
            env.get("ALERT_WEBHOOK_URL", {}).get("sync") is False,
            f"{name} must define ALERT_WEBHOOK_URL as a secret env var",
            failures,
        )
        expect(
            env.get("ALERT_QUEUE_DEPTH_THRESHOLD", {}).get("value") == "100",
            f"{name} must define the production queue-depth alert threshold",
            failures,
        )
        expect(
            env.get("ALLOW_REPO_ANALYSIS_FALLBACK", {}).get("value") == "false",
            f"{name} must not allow heuristic repo analysis fallback",
            failures,
        )
        expect(
            env.get("ALLOW_VERCEL_PREVIEW_ORIGINS", {}).get("value") == "false",
            f"{name} must not allow every Vercel preview origin in production",
            failures,
        )
        expect(
            env.get("CORS_ORIGIN_REGEX", {}).get("value") == "",
            f"{name} must keep broad CORS regex disabled in production",
            failures,
        )
        expect(
            env.get("DATABASE_URL", {}).get("fromDatabase", {}).get("name") == "hackmarket-db",
            f"{name} DATABASE_URL must come from hackmarket-db",
            failures,
        )
        expect(
            env.get("REDIS_URL", {}).get("fromService", {}).get("name") == "hackmarket-redis",
            f"{name} REDIS_URL must come from hackmarket-redis",
            failures,
        )

    if worker is not None:
        expect(
            worker.get("dockerCommand") == "arq app.worker.WorkerSettings",
            "start-worker must run the ARQ worker command",
            failures,
        )
        expect(
            worker.get("maxShutdownDelaySeconds", 0) >= 300,
            "start-worker should have enough shutdown delay to finish active jobs",
            failures,
        )


def check_repo_files(failures: list[str]) -> None:
    package_json = load_json(WEB_PACKAGE)
    start_script = package_json.get("scripts", {}).get("start")
    expect(
        start_script == "node .next/standalone/server.js",
        "apps/web must start the standalone Next.js server in production",
        failures,
    )

    requirements = API_REQUIREMENTS.read_text(encoding="utf-8")
    expect("arq==" in requirements, "apps/api requirements must include arq for worker jobs", failures)
    expect(JOBS_MIGRATION.exists(), "tool processing jobs migration is missing", failures)

    env_example = ENV_EXAMPLE.read_text(encoding="utf-8")
    for key in [
        "WORKER_QUEUE_NAME",
        "WORKER_HEALTH_CHECK_KEY",
        "RUN_BILLING_SCHEDULER_IN_API",
        "ALERT_WEBHOOK_URL",
        "ALERT_QUEUE_DEPTH_THRESHOLD",
        "OPENROUTER_API_KEY",
        "S3_BUCKET_NAME",
        "RENDER_TOOL_PLAN",
    ]:
        expect(f"{key}=" in env_example, f".env.example is missing {key}", failures)

    for legacy_path in ["render 2.yaml", "render copy.yaml"]:
        expect(not (REPO_ROOT / legacy_path).exists(), f"remove stale blueprint file {legacy_path}", failures)


def main() -> int:
    failures: list[str] = []

    try:
        check_render_blueprint(failures)
        check_repo_files(failures)
    except Exception as exc:
        print(f"production readiness check crashed: {exc}", file=sys.stderr)
        return 2

    if failures:
        print("Production readiness check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Production readiness check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
