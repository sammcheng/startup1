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
DATA_INTEGRITY_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0008_add_data_integrity_constraints.py"
)
ADMIN_AUDIT_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0009_add_admin_audit_logs.py"
)
ENV_EXAMPLE = REPO_ROOT / ".env.example"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
SECURITY_SCAN = REPO_ROOT / "scripts" / "security_scan.py"
REPO_HYGIENE_CHECK = REPO_ROOT / "scripts" / "repo_hygiene_check.py"
MIGRATION_SAFETY_CHECK = REPO_ROOT / "scripts" / "check_migration_safety.py"
BILLING_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "billing_service.py"
API_MAIN = REPO_ROOT / "apps" / "api" / "app" / "main.py"
API_ADMIN_ROUTER = REPO_ROOT / "apps" / "api" / "app" / "routers" / "admin.py"
OPERATIONS_HEALTH_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "operations_health_service.py"
ADMIN_AUDIT_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "admin_audit_service.py"
PRODUCTION_SMOKE_CHECK = REPO_ROOT / "scripts" / "production_smoke_check.py"
URL_SAFETY = REPO_ROOT / "apps" / "api" / "app" / "services" / "url_safety.py"
WEB_ADMIN_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "admin" / "page.tsx"


API_REQUIRED_ENV = {
    "ENVIRONMENT",
    "DEBUG",
    "APP_BASE_URL",
    "PUBLIC_API_BASE_URL",
    "CORS_ORIGINS",
    "CORS_ORIGIN_REGEX",
    "ALLOW_VERCEL_PREVIEW_ORIGINS",
    "MAX_SOURCE_ZIP_ENTRIES",
    "MAX_SOURCE_ZIP_UNCOMPRESSED_BYTES",
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
    "ALERT_DEDUPE_TTL_SECONDS",
    "ALERT_QUEUE_DEPTH_THRESHOLD",
    "ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS",
    "ALERT_FAILED_PROCESSING_JOBS_THRESHOLD",
    "ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS",
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
    "GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD",
    "GATEWAY_RATE_LIMIT_VIOLATION_WINDOW_SECONDS",
    "MAX_ACTIVE_API_KEYS_PER_USER",
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
            env.get("ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS", {}).get("value") == "1800",
            f"{name} must define the production stuck processing-job alert threshold",
            failures,
        )
        expect(
            env.get("ALERT_FAILED_PROCESSING_JOBS_THRESHOLD", {}).get("value") == "3",
            f"{name} must define the production failed processing-job alert threshold",
            failures,
        )
        expect(
            env.get("ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS", {}).get("value") == "900",
            f"{name} must define the production failed processing-job alert window",
            failures,
        )
        expect(
            env.get("ALERT_DEDUPE_TTL_SECONDS", {}).get("value") == "900",
            f"{name} must define the production alert dedupe window",
            failures,
        )
        expect(
            env.get("GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD", {}).get("value") == "3",
            f"{name} must define gateway rate-limit abuse alert threshold",
            failures,
        )
        expect(
            env.get("MAX_ACTIVE_API_KEYS_PER_USER", {}).get("value") == "10",
            f"{name} must cap active API keys per user",
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
            env.get("MAX_SOURCE_ZIP_ENTRIES", {}).get("value") == "500",
            f"{name} must cap uploaded source zip entry count",
            failures,
        )
        expect(
            env.get("MAX_SOURCE_ZIP_UNCOMPRESSED_BYTES", {}).get("value") == "104857600",
            f"{name} must cap uploaded source zip uncompressed size",
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
    expect(DATA_INTEGRITY_MIGRATION.exists(), "data integrity constraints migration is missing", failures)
    expect(ADMIN_AUDIT_MIGRATION.exists(), "admin audit log migration is missing", failures)
    expect(SECURITY_SCAN.exists(), "tracked-file security scan is missing", failures)
    expect(REPO_HYGIENE_CHECK.exists(), "tracked-file repository hygiene check is missing", failures)
    expect(MIGRATION_SAFETY_CHECK.exists(), "migration safety check is missing", failures)
    expect(PRODUCTION_SMOKE_CHECK.exists(), "production smoke check is missing", failures)
    expect(URL_SAFETY.exists(), "production URL safety guard is missing", failures)

    billing_service = BILLING_SERVICE.read_text(encoding="utf-8")
    expect(
        "_existing_usage_invoice_id" in billing_service,
        "billing scheduler must guard usage invoices with DB-backed idempotency",
        failures,
    )
    expect(
        "_existing_seller_payout_id" in billing_service,
        "billing scheduler must guard seller payouts with DB-backed idempotency",
        failures,
    )

    api_main = API_MAIN.read_text(encoding="utf-8")
    expect(OPERATIONS_HEALTH_SERVICE.exists(), "shared operations health service is missing", failures)
    operations_health_service = OPERATIONS_HEALTH_SERVICE.read_text(encoding="utf-8")
    expect("get_operations_health" in operations_health_service, "operations health service must expose shared health summary", failures)
    expect("processing_job_check" in operations_health_service, "operations health service must centralize processing-job risk classification", failures)
    expect(
        "worker_heartbeat" in api_main and "missing_heartbeat" in api_main,
        "API readiness must expose worker heartbeat status",
        failures,
    )
    expect(
        "degraded_high_depth" in operations_health_service,
        "shared operations health must degrade when worker queue depth is too high",
        failures,
    )
    expect("operations_health_service.get_operations_health" in api_main, "API readiness must use the shared operations health service", failures)

    admin_router = API_ADMIN_ROUTER.read_text(encoding="utf-8")
    expect("operations_health_service.get_operations_health" in admin_router, "admin health endpoint must use the shared operations health service", failures)
    expect(ADMIN_AUDIT_SERVICE.exists(), "admin audit service is missing", failures)
    admin_audit_service = ADMIN_AUDIT_SERVICE.read_text(encoding="utf-8")
    expect("record_admin_action" in admin_audit_service, "admin mutations must have a durable audit recorder", failures)
    expect("list_admin_audit_logs" in admin_audit_service, "admin dashboard must expose audit history", failures)
    expect("record_admin_action" in admin_router, "admin mutation routes must record audit actions", failures)
    expect("/audit-logs" in admin_router, "admin API must expose audit logs to admins", failures)

    smoke_check = PRODUCTION_SMOKE_CHECK.read_text(encoding="utf-8")
    expect("check_api_auth_boundary" in smoke_check, "smoke checks must verify protected API routes", failures)
    expect("parse_json_error" in smoke_check, "smoke checks must verify structured API error payloads", failures)
    expect("check_api_cors" in smoke_check, "smoke checks must verify production CORS behavior", failures)
    expect("check_submission_status_page" in smoke_check, "smoke checks must verify submission status pages", failures)
    expect("check_admin_operations_health" in smoke_check, "smoke checks must verify admin operations health when an admin token is provided", failures)

    admin_page = WEB_ADMIN_PAGE.read_text(encoding="utf-8")
    expect("/admin/operations-health" in admin_page, "admin dashboard must load production operations health", failures)
    expect("/admin/audit-logs" in admin_page, "admin dashboard must load audit logs", failures)
    expect("Production health" in admin_page, "admin dashboard must render production health status", failures)
    expect("Audit trail" in admin_page, "admin dashboard must render admin audit trail", failures)

    url_safety = URL_SAFETY.read_text(encoding="utf-8")
    expect("validate_public_tool_endpoint" in url_safety, "API must validate outbound seller tool URLs", failures)
    expect("is_private" in url_safety and "is_loopback" in url_safety, "URL safety must reject private/loopback IPs", failures)
    expect("getaddrinfo" in url_safety, "URL safety must resolve hostnames before outbound tool calls", failures)
    expect("validate_public_tool_endpoint_async" in url_safety and "to_thread" in url_safety, "URL safety DNS checks must not block the async request path", failures)
    expect("https" in url_safety, "URL safety must require HTTPS tool endpoints in production", failures)

    ci_workflow = CI_WORKFLOW.read_text(encoding="utf-8")
    expect("python scripts/security_scan.py" in ci_workflow, "CI must scan tracked files for secrets", failures)
    expect(
        "python ../../scripts/check_migration_safety.py" in ci_workflow,
        "CI must scan Alembic upgrades for destructive migration operations",
        failures,
    )
    expect(
        "python scripts/repo_hygiene_check.py" in ci_workflow,
        "CI must block committed build artifacts and local files",
        failures,
    )
    expect("npm audit --audit-level=high" in ci_workflow, "CI must audit Node dependencies", failures)
    expect("npm run test:env" in ci_workflow, "CI must test frontend environment validation", failures)
    expect("npm run test:security" in ci_workflow, "CI must test frontend security headers", failures)
    expect("npm run build" in ci_workflow, "CI must build the frontend", failures)

    env_example = ENV_EXAMPLE.read_text(encoding="utf-8")
    for key in [
        "WORKER_QUEUE_NAME",
        "WORKER_HEALTH_CHECK_KEY",
        "RUN_BILLING_SCHEDULER_IN_API",
        "ALERT_WEBHOOK_URL",
        "ALERT_DEDUPE_TTL_SECONDS",
        "ALERT_QUEUE_DEPTH_THRESHOLD",
        "ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS",
        "ALERT_FAILED_PROCESSING_JOBS_THRESHOLD",
        "ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS",
        "MAX_SOURCE_ZIP_ENTRIES",
        "MAX_SOURCE_ZIP_UNCOMPRESSED_BYTES",
        "GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD",
        "MAX_ACTIVE_API_KEYS_PER_USER",
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
