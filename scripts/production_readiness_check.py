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
WEB_DOCKERFILE = REPO_ROOT / "apps" / "web" / "Dockerfile.prod"
WEB_CONTAINER_START = REPO_ROOT / "apps" / "web" / "scripts" / "start-container.mjs"
API_REQUIREMENTS = REPO_ROOT / "apps" / "api" / "requirements.txt"
API_DEV_REQUIREMENTS = REPO_ROOT / "apps" / "api" / "requirements-dev.txt"
JOBS_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0007_add_tool_processing_jobs.py"
)
DATA_INTEGRITY_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0008_add_data_integrity_constraints.py"
)
ADMIN_AUDIT_MIGRATION = (
    REPO_ROOT / "apps" / "api" / "alembic" / "versions" / "0009_add_admin_audit_logs.py"
)
SYNTHETIC_METRICS_MIGRATION = (
    REPO_ROOT
    / "apps"
    / "api"
    / "alembic"
    / "versions"
    / "0010_clear_synthetic_curated_tool_metrics.py"
)
USER_EMAIL_INTEGRITY_MIGRATION = (
    REPO_ROOT
    / "apps"
    / "api"
    / "alembic"
    / "versions"
    / "0012_enforce_case_insensitive_user_emails.py"
)
ENV_EXAMPLE = REPO_ROOT / ".env.example"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
SECURITY_SCAN = REPO_ROOT / "scripts" / "security_scan.py"
REPO_HYGIENE_CHECK = REPO_ROOT / "scripts" / "repo_hygiene_check.py"
MIGRATION_SAFETY_CHECK = REPO_ROOT / "scripts" / "check_migration_safety.py"
ALEMBIC_MIGRATION_CHECK = REPO_ROOT / "scripts" / "check_alembic_migrations.py"
BILLING_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "billing_service.py"
API_KEY_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "api_key_service.py"
HASHING_UTILS = REPO_ROOT / "apps" / "api" / "app" / "utils" / "hashing.py"
TOOL_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "tool_service.py"
API_MAIN = REPO_ROOT / "apps" / "api" / "app" / "main.py"
API_CONFIG = REPO_ROOT / "apps" / "api" / "app" / "config.py"
API_ADMIN_ROUTER = REPO_ROOT / "apps" / "api" / "app" / "routers" / "admin.py"
API_TOOLS_ROUTER = REPO_ROOT / "apps" / "api" / "app" / "routers" / "tools.py"
API_INTERNAL_ROUTER = REPO_ROOT / "apps" / "api" / "app" / "routers" / "internal.py"
BOOTSTRAP_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "bootstrap_service.py"
OPERATIONS_HEALTH_SERVICE = (
    REPO_ROOT / "apps" / "api" / "app" / "services" / "operations_health_service.py"
)
ADMIN_AUDIT_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "admin_audit_service.py"
PRODUCTION_SMOKE_CHECK = REPO_ROOT / "scripts" / "production_smoke_check.py"
PRODUCTION_LOAD_SMOKE_CHECK = REPO_ROOT / "scripts" / "production_load_smoke_check.py"
URL_SAFETY = REPO_ROOT / "apps" / "api" / "app" / "services" / "url_safety.py"
PROXY_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "proxy_service.py"
GATEWAY_SIGNING = REPO_ROOT / "apps" / "api" / "app" / "services" / "gateway_signing.py"
RENDER_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "render_service.py"
SOURCE_ARCHIVE = REPO_ROOT / "apps" / "api" / "app" / "services" / "source_archive.py"
CONTAINER_SERVICE = REPO_ROOT / "apps" / "api" / "app" / "services" / "container_service.py"
WEB_ADMIN_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "admin" / "page.tsx"
WEB_DASHBOARD_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "dashboard" / "page.tsx"
WEB_ENV = REPO_ROOT / "apps" / "web" / "src" / "lib" / "env.ts"
WEB_SECURITY_HEADERS = REPO_ROOT / "apps" / "web" / "security-headers.mjs"
WEB_API_CLIENT = REPO_ROOT / "apps" / "web" / "src" / "lib" / "api.ts"
WEB_HOME_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "page.tsx"
WEB_LANDING_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "LandingPage.tsx"
WEB_PRICING_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "pricing" / "page.tsx"
WEB_SELLER_AGREEMENT_PAGE = (
    REPO_ROOT / "apps" / "web" / "src" / "app" / "seller-agreement" / "page.tsx"
)
WEB_SUBMIT_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "submit" / "page.tsx"
WEB_MARKETPLACE_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "marketplace" / "page.tsx"
WEB_MARKETPLACE_CLIENT = (
    REPO_ROOT / "apps" / "web" / "src" / "app" / "marketplace" / "MarketplaceClient.tsx"
)
WEB_TOOL_PAGE = REPO_ROOT / "apps" / "web" / "src" / "app" / "tools" / "[slug]" / "page.tsx"
WEB_DOCS_CLIENT = REPO_ROOT / "apps" / "web" / "src" / "app" / "docs" / "DocsClient.tsx"
WEB_DEMO_RUNNER = REPO_ROOT / "apps" / "web" / "src" / "components" / "demo" / "DemoRunner.tsx"
WEB_LIVE_BENCHMARK = (
    REPO_ROOT / "apps" / "web" / "src" / "components" / "demo" / "LiveBenchmark.tsx"
)
WEB_FILE_OUTPUT = REPO_ROOT / "apps" / "web" / "src" / "components" / "demo" / "FileOutput.tsx"
WEB_IMAGE_OUTPUT = REPO_ROOT / "apps" / "web" / "src" / "components" / "demo" / "ImageOutput.tsx"
WEB_PURCHASE_BUTTON = (
    REPO_ROOT / "apps" / "web" / "src" / "components" / "billing" / "PurchaseToolButton.tsx"
)
WEB_SAFE_URL = REPO_ROOT / "apps" / "web" / "src" / "lib" / "safe-url.ts"
WEB_CONVERTER_TOOLS = REPO_ROOT / "apps" / "web" / "src" / "lib" / "converterTools.ts"
SELLER_TOOL_ROOT = REPO_ROOT / "apps" / "seller-tools" / "home-accessibility-checker"
SELLER_TOOL_SERVER = SELLER_TOOL_ROOT / "server.js"
SELLER_TOOL_GATEWAY_AUTH = SELLER_TOOL_ROOT / "services" / "gateway-auth.js"
SELLER_TOOL_OPENROUTER = SELLER_TOOL_ROOT / "services" / "openrouter-service.js"
SELLER_TOOL_VISION = SELLER_TOOL_ROOT / "services" / "rekognition-service.js"
SELLER_TOOL_COMPREHENSIVE = SELLER_TOOL_ROOT / "services" / "comprehensive-analysis-service.js"
SELLER_TOOL_URL_SAFETY = SELLER_TOOL_ROOT / "services" / "url-safety.js"
SELLER_TOOL_LISTING_SCRAPER = SELLER_TOOL_ROOT / "services" / "listing-scraper-service.js"
SELLER_TOOL_IMAGE_SERVICE = SELLER_TOOL_ROOT / "services" / "image-service.js"
CONVERTER_SERVICE = REPO_ROOT / "apps" / "converter" / "main.py"
PRODUCTION_LAUNCH_CHECKLIST = REPO_ROOT / "docs" / "production-launch-checklist.md"
GATEWAY_KEY_GENERATOR = REPO_ROOT / "scripts" / "generate_tool_gateway_keys.py"


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
    "STRIPE_WEBHOOK_JOB_EXPIRES_SECONDS",
    "USAGE_LOG_JOB_EXPIRES_SECONDS",
    "RUN_BILLING_SCHEDULER_IN_API",
    "TOOL_GATEWAY_SIGNING_PRIVATE_KEY",
    "TOOL_GATEWAY_SIGNING_KEY_ID",
    "TOOL_GATEWAY_SIGNATURE_TTL_SECONDS",
    "ALERT_WEBHOOK_URL",
    "ALERT_WEBHOOK_TIMEOUT_SECONDS",
    "ALERT_DEDUPE_TTL_SECONDS",
    "ALERT_QUEUE_DEPTH_THRESHOLD",
    "ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS",
    "ALERT_FAILED_PROCESSING_JOBS_THRESHOLD",
    "ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS",
    "ALERT_STRIPE_WEBHOOK_STALE_AFTER_SECONDS",
    "ALERT_FAILED_STRIPE_WEBHOOKS_THRESHOLD",
    "ALERT_FAILED_STRIPE_WEBHOOKS_WINDOW_SECONDS",
    "CONVERTER_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SECRET",
    "CLERK_JWKS_URL",
    "CLERK_ISSUER_URL",
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
    "REPO_ANALYSIS_RATE_LIMIT_PER_HOUR",
    "REPO_ANALYSIS_LOCK_SECONDS",
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
        expect(
            service.get("plan") not in {None, "free"},
            f"{name} must not use a free Render plan",
            failures,
        )
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
        expect(
            database.get("ipAllowList") == [],
            "hackmarket-db should not expose public IP access",
            failures,
        )

    if redis is not None:
        expect(
            redis.get("maxmemoryPolicy") == "noeviction",
            "hackmarket-redis must use noeviction so queued jobs cannot be discarded",
            failures,
        )

    for name, service in {"start": api, "start-worker": worker}.items():
        if service is None:
            continue
        env = env_map(service)
        missing = sorted(API_REQUIRED_ENV - set(env))
        expect(not missing, f"{name} is missing env vars: {', '.join(missing)}", failures)
        expect(
            env.get("ENVIRONMENT", {}).get("value") == "production",
            f"{name} must run production env",
            failures,
        )
        expect(
            env.get("DEBUG", {}).get("value") == "false",
            f"{name} must disable debug mode",
            failures,
        )
        expect(
            env.get("RUN_BILLING_SCHEDULER_IN_API", {}).get("value") == "false",
            f"{name} must keep API billing scheduler disabled",
            failures,
        )
        expect(
            env.get("TOOL_GATEWAY_SIGNING_PRIVATE_KEY", {}).get("sync") is False,
            f"{name} must define the gateway signing private key as a secret",
            failures,
        )
        expect(
            env.get("TOOL_GATEWAY_SIGNING_KEY_ID", {}).get("value") == "launch-1",
            f"{name} must define the expected gateway signing key ID",
            failures,
        )
        expect(
            env.get("TOOL_GATEWAY_SIGNATURE_TTL_SECONDS", {}).get("value") == "300",
            f"{name} must define a bounded gateway signature lifetime",
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
            env.get("REPO_ANALYSIS_RATE_LIMIT_PER_HOUR", {}).get("value") == "5"
            and env.get("REPO_ANALYSIS_LOCK_SECONDS", {}).get("value") == "180",
            f"{name} must bound account repository analysis load",
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
            env.get("STRIPE_WEBHOOK_JOB_EXPIRES_SECONDS", {}).get("value") == "604800",
            f"{name} must retain Stripe webhook jobs long enough for provider retries",
            failures,
        )
        expect(
            env.get("USAGE_LOG_JOB_EXPIRES_SECONDS", {}).get("value") == "604800",
            f"{name} must retain usage-ledger retries through prolonged worker outages",
            failures,
        )
        expect(
            env.get("ALERT_STRIPE_WEBHOOK_STALE_AFTER_SECONDS", {}).get("value") == "900",
            f"{name} must define the stuck Stripe-webhook alert threshold",
            failures,
        )
        expect(
            env.get("ALERT_FAILED_STRIPE_WEBHOOKS_THRESHOLD", {}).get("value") == "1",
            f"{name} must alert on failed Stripe webhook processing",
            failures,
        )
        expect(
            env.get("ALERT_FAILED_STRIPE_WEBHOOKS_WINDOW_SECONDS", {}).get("value") == "900",
            f"{name} must define the failed Stripe-webhook alert window",
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

    if seller_tool is not None:
        seller_env = env_map(seller_tool)
        expect(
            seller_tool.get("healthCheckPath") == "/ready",
            "home-accessibility-checker must use its provider-aware readiness endpoint",
            failures,
        )
        expect(
            seller_env.get("OPENROUTER_API_KEY", {}).get("sync") is False,
            "home-accessibility-checker must define OPENROUTER_API_KEY as a secret",
            failures,
        )
        expect(
            seller_env.get("NODE_ENV", {}).get("value") == "production",
            "home-accessibility-checker must run with NODE_ENV=production",
            failures,
        )
        expect(
            seller_env.get("HACKMARKET_GATEWAY_PUBLIC_KEY", {}).get("sync") is False,
            "home-accessibility-checker must define the gateway public key",
            failures,
        )
        expect(
            seller_env.get("HACKMARKET_GATEWAY_KEY_ID", {}).get("value") == "launch-1",
            "home-accessibility-checker must use the API gateway signing key ID",
            failures,
        )
        expect(
            seller_env.get("HACKMARKET_GATEWAY_SIGNATURE_TTL_SECONDS", {}).get("value") == "300",
            "home-accessibility-checker must use a bounded gateway signature lifetime",
            failures,
        )
        expect(
            seller_env.get("HACKMARKET_TOOL_SLUG", {}).get("value") == "home-accessibility-checker",
            "home-accessibility-checker must bind signatures to its tool slug",
            failures,
        )
        expect(
            seller_env.get("ALLOW_UNSIGNED_GATEWAY_REQUESTS", {}).get("value") == "false",
            "home-accessibility-checker must reject unsigned production requests",
            failures,
        )
        expect(
            "TOOL_GATEWAY_SIGNING_PRIVATE_KEY" not in seller_env,
            "home-accessibility-checker must never receive the gateway private key",
            failures,
        )
        expect(
            seller_env.get("OPENROUTER_MODEL", {}).get("value"),
            "home-accessibility-checker must configure its OpenRouter model",
            failures,
        )
        expect(
            seller_env.get("ALLOWED_ORIGINS", {}).get("value", "").startswith("https://"),
            "home-accessibility-checker must use an explicit HTTPS CORS origin",
            failures,
        )
        expect(
            not ({"OPENAI_API_KEY", "GEMINI_API_KEY"} & set(seller_env)),
            "home-accessibility-checker must not request unused provider secrets",
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
    dev_requirements = API_DEV_REQUIREMENTS.read_text(encoding="utf-8")
    ci_workflow = CI_WORKFLOW.read_text(encoding="utf-8")
    web_dockerfile = WEB_DOCKERFILE.read_text(encoding="utf-8")
    web_docker_ci = ci_workflow.split("- name: Build web image", 1)[-1]
    expect(
        "arq==" in requirements, "apps/api requirements must include arq for worker jobs", failures
    )
    expect(
        "PyJWT[crypto]==" in requirements,
        "API auth must use the audited PyJWT cryptography backend",
        failures,
    )
    expect(
        "cryptography==" in requirements,
        "API runtime must pin cryptography for Ed25519 gateway signing",
        failures,
    )
    expect(
        "python-jose" not in requirements,
        "API runtime must not include the vulnerable python-jose stack",
        failures,
    )
    expect(
        "ruff==" in dev_requirements and "pip-audit==" in dev_requirements,
        "backend development requirements must include lint and dependency audit tools",
        failures,
    )
    expect(JOBS_MIGRATION.exists(), "tool processing jobs migration is missing", failures)
    expect(
        DATA_INTEGRITY_MIGRATION.exists(),
        "data integrity constraints migration is missing",
        failures,
    )
    expect(ADMIN_AUDIT_MIGRATION.exists(), "admin audit log migration is missing", failures)
    expect(
        SYNTHETIC_METRICS_MIGRATION.exists(),
        "synthetic curated-tool metric cleanup migration is missing",
        failures,
    )
    expect(SECURITY_SCAN.exists(), "tracked-file security scan is missing", failures)
    expect(
        REPO_HYGIENE_CHECK.exists(), "tracked-file repository hygiene check is missing", failures
    )
    expect(MIGRATION_SAFETY_CHECK.exists(), "migration safety check is missing", failures)
    expect(
        ALEMBIC_MIGRATION_CHECK.exists(), "Alembic upgrade validation check is missing", failures
    )
    expect(PRODUCTION_SMOKE_CHECK.exists(), "production smoke check is missing", failures)
    expect(PRODUCTION_LOAD_SMOKE_CHECK.exists(), "production load smoke check is missing", failures)
    expect(GATEWAY_KEY_GENERATOR.exists(), "gateway signing key generator is missing", failures)
    expect(URL_SAFETY.exists(), "production URL safety guard is missing", failures)
    expect(SOURCE_ARCHIVE.exists(), "source archive safety guard is missing", failures)
    expect(
        "ARG NEXT_PUBLIC_API_URL" in web_dockerfile
        and "ARG NEXT_PUBLIC_APP_URL" in web_dockerfile
        and "ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" in web_dockerfile
        and "ARG CLERK_SECRET_KEY" not in web_dockerfile
        and "CLERK_SECRET_KEY=$CLERK_SECRET_KEY" not in web_dockerfile,
        "web production Dockerfile must accept public build args without baking Clerk secrets",
        failures,
    )
    expect(
        WEB_CONTAINER_START.exists()
        and 'CMD ["node", "start-container.mjs"]' in web_dockerfile
        and "CLERK_SECRET_KEY is required at container runtime"
        in WEB_CONTAINER_START.read_text(encoding="utf-8"),
        "web production container must validate the Clerk secret at runtime",
        failures,
    )
    expect(
        "build-args:" in web_docker_ci
        and "NEXT_PUBLIC_API_URL=https://api.hackmarket.io/v1" in web_docker_ci
        and "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_" in web_docker_ci
        and "CLERK_SECRET_KEY=" not in web_docker_ci,
        "CI web Docker image build must pass public placeholders without a Clerk secret",
        failures,
    )

    billing_service = BILLING_SERVICE.read_text(encoding="utf-8")
    compact_billing_service = "".join(billing_service.split())
    expect(
        "_existing_usage_invoice" in billing_service,
        "billing scheduler must guard usage invoices with DB-backed idempotency",
        failures,
    )
    expect(
        "_existing_seller_payout_id" in billing_service,
        "billing scheduler must guard seller payouts with DB-backed idempotency",
        failures,
    )
    expect(
        "_terminate_stale_pending_purchase" in billing_service
        and "_fail_checkout_creation" in billing_service,
        "tool purchases must not leave unrecoverable pending checkout records",
        failures,
    )
    expect(
        "_is_trusted_stripe_checkout_url" in billing_service
        and 'parsed.hostname == "checkout.stripe.com"' in billing_service
        and "trusted checkout URL" in billing_service,
        "backend billing must only return trusted Stripe Checkout URLs",
        failures,
    )
    expect(
        "_is_trusted_stripe_connect_url" in billing_service
        and 'parsed.hostname == "connect.stripe.com"' in billing_service
        and "trusted onboarding URL" in billing_service,
        "backend billing must only return trusted Stripe Connect onboarding URLs",
        failures,
    )
    expect(
        'checkout_session.get("id")orcheckout_session.get("payment_intent")'
        in compact_billing_service,
        "pending tool purchases must store checkout session IDs so checkout URLs can be recovered",
        failures,
    )
    expect(
        "checkout.session.async_payment_succeeded" in billing_service
        and "checkout.session.async_payment_failed" in billing_service
        and "_checkout_session_is_paid" in billing_service,
        "checkout session webhooks must not activate purchases before payment is confirmed",
        failures,
    )
    expect(
        "_stripe_idempotency_key" in billing_service
        and "idempotency_key=" in billing_service
        and "stripe_invoice_id" in billing_service,
        "Stripe mutations and invoice ledger records must be retry-safe",
        failures,
    )
    expect(
        "_settle_usage_invoice" in billing_service
        and "stripe.Invoice.retrieve" in billing_service
        and "stripe.Invoice.finalize_invoice" in billing_service
        and "invoice_id,auto_advance=True,idempotency_key=" in compact_billing_service,
        "usage invoices must resume after interruption and enable Stripe automatic collection retries",
        failures,
    )
    expect(
        "Tool.seller_id!=user_id" in compact_billing_service,
        "usage invoicing must never bill sellers for invoking their own tools",
        failures,
    )
    expect(
        "charge.refunded" in billing_service
        and "_handle_charge_refunded" in billing_service
        and "TransactionStatus.refund_pending" in billing_service
        and "stripe_transfer_reversal_id" in billing_service,
        "Stripe refunds must hold partial payouts, revoke full-sale access, and reverse completed payouts",
        failures,
    )
    expect(
        "_get_checkout_records" in billing_service
        and "_checkout_transaction_matches_purchase" in billing_service
        and "transaction.buyer_id == purchase.buyer_id" in billing_service
        and "transaction.type == TransactionType.full_purchase" in billing_service,
        "checkout session webhooks must verify purchase and transaction metadata match before state changes",
        failures,
    )
    billing_router = (REPO_ROOT / "apps" / "api" / "app" / "routers" / "billing.py").read_text(
        encoding="utf-8"
    )
    expect(
        "stripe_webhook_misconfigured" in billing_router
        and "stripe_webhook_secret" in billing_router
        and "Webhook secret not set" in billing_router,
        "Stripe webhook route must fail closed when STRIPE_WEBHOOK_SECRET is missing",
        failures,
    )
    expect(
        "stripe_event_service.accept_verified_event" in billing_router,
        "Stripe webhook requests must persist and queue a durable receipt before returning",
        failures,
    )
    worker_source = (REPO_ROOT / "apps" / "api" / "app" / "worker.py").read_text(encoding="utf-8")
    expect(
        "process_stripe_webhook_job" in worker_source and "process_usage_log_job" in worker_source,
        "background worker must process durable Stripe events and usage-ledger retries",
        failures,
    )

    tool_service = TOOL_SERVICE.read_text(encoding="utf-8")
    expect(
        "IntegrityError" in tool_service and "_MAX_SLUG_CREATE_ATTEMPTS" in tool_service,
        "tool creation must retry slug races caused by concurrent submissions",
        failures,
    )
    expect(
        'return slug[:90] or "tool"' in tool_service,
        "tool slug generation must have a safe fallback for non-sluggable names",
        failures,
    )
    expect(
        "get_tool_for_seller" in tool_service and "Tool.seller_id == seller_id" in tool_service,
        "seller-owned tool routes must use account-scoped tool lookup",
        failures,
    )
    discovery_service = (
        REPO_ROOT / "apps" / "api" / "app" / "services" / "discovery_service.py"
    ).read_text(encoding="utf-8")
    tools_router = API_TOOLS_ROUTER.read_text(encoding="utf-8")
    gateway_router = (REPO_ROOT / "apps" / "api" / "app" / "routers" / "gateway.py").read_text(
        encoding="utf-8"
    )
    expect(
        "public_availability_conditions" in tool_service
        and "Tool.seller.has(User.is_active.is_(True))" in tool_service
        and "public_availability_conditions" in discovery_service
        and "get_marketplace_stats" in tool_service,
        "public marketplace queries must exclude tools owned by inactive sellers",
        failures,
    )
    expect(
        tools_router.count("tool_service.is_publicly_available(tool)") >= 3
        and "tool_service.is_publicly_available(tool)" in gateway_router
        and "tool_service.is_publicly_available(tool, seller)" in billing_service,
        "inactive seller tools must be blocked from details, demos, docs, purchases, and gateway calls",
        failures,
    )
    api_key_service = API_KEY_SERVICE.read_text(encoding="utf-8")
    hashing_utils = HASHING_UTILS.read_text(encoding="utf-8")
    expect(
        "_lock_user_for_api_key_create" in api_key_service
        and "with_for_update" in api_key_service
        and "max_active_api_keys_per_user" in api_key_service,
        "API key creation must serialize per user before enforcing the active-key cap",
        failures,
    )
    dependencies = (REPO_ROOT / "apps" / "api" / "app" / "dependencies.py").read_text(
        encoding="utf-8"
    )
    expect(
        "is_api_key_format" in hashing_utils
        and "is_api_key_format(x_api_key)" in dependencies
        and "hash_api_key(x_api_key)" in dependencies,
        "gateway API key validation must reject malformed keys before hashing and database lookup",
        failures,
    )
    auth_service = (REPO_ROOT / "apps" / "api" / "app" / "services" / "auth_service.py").read_text(
        encoding="utf-8"
    )
    expect(
        "user.is_active = True" not in auth_service,
        "identity synchronization must not reactivate suspended or deleted accounts",
        failures,
    )
    expect(
        "_normalize_email(identity.email" in auth_service
        and USER_EMAIL_INTEGRITY_MIGRATION.exists()
        and "ux_users_email_lower" in USER_EMAIL_INTEGRITY_MIGRATION.read_text(encoding="utf-8"),
        "verified emails must be normalized and uniquely enforced without case sensitivity",
        failures,
    )
    expect(
        "if not user.is_active:" in dependencies
        and 'raise Unauthorized("This account is suspended.")' in dependencies,
        "authenticated requests must reject suspended accounts before lazy synchronization",
        failures,
    )
    expect(
        "_validate_clerk_authorized_party(claims)" in dependencies
        and "settings.app_base_url" in dependencies
        and "settings.cors_origins" in dependencies
        and "_validate_configured_jwks_url" in dependencies,
        "Clerk tokens must validate their frontend origin and use a trusted JWKS host",
        failures,
    )
    api_keys_router = (REPO_ROOT / "apps" / "api" / "app" / "routers" / "api_keys.py").read_text(
        encoding="utf-8"
    )
    expect(
        "get_api_key_for_user" in api_key_service
        and "APIKey.user_id == user_id" in api_key_service
        and "get_api_key_for_user" in api_keys_router
        and "You do not own this API key" not in api_keys_router,
        "API key revocation must not reveal whether another user's key ID exists",
        failures,
    )

    api_main = API_MAIN.read_text(encoding="utf-8")
    api_config = API_CONFIG.read_text(encoding="utf-8")
    expect(
        "INVALID_CONTENT_LENGTH" in api_main
        and "REQUEST_TOO_LARGE" in api_main
        and "max_request_body_bytes" in api_main,
        "API middleware must reject malformed and oversized request bodies before route handling",
        failures,
    )
    expect(
        "normalize_request_id" in api_main
        and "MAX_REQUEST_ID_LENGTH" in api_main
        and "REQUEST_ID_ALLOWED_CHARS" in api_main,
        "API middleware must normalize inbound request IDs before echoing them in logs and response headers",
        failures,
    )
    expect(
        "enable_bootstrap_tool_seed: bool = False" in api_config,
        "bootstrap tool seed must default off",
        failures,
    )
    expect(
        "ENABLE_BOOTSTRAP_TOOL_SEED must be false in production" in api_config,
        "production must reject fixed bootstrap marketplace seeds",
        failures,
    )
    expect(
        "Production provider keys must use live mode" in api_config
        and "_is_test_mode_provider_key" in api_config,
        "production config must reject test-mode Clerk and Stripe provider keys",
        failures,
    )
    expect(BOOTSTRAP_SERVICE.exists(), "bootstrap seed service is missing", failures)
    bootstrap_service = BOOTSTRAP_SERVICE.read_text(encoding="utf-8")
    expect(
        "avg_response_time_ms=420" not in bootstrap_service
        and 'uptime_percentage=Decimal("99.90")' not in bootstrap_service,
        "bootstrap data must not seed synthetic latency or uptime metrics",
        failures,
    )

    converter_tools = WEB_CONVERTER_TOOLS.read_text(encoding="utf-8")
    expect(
        "avg_response_time_ms: c.qa_avg_ms ?? null" in converter_tools
        and "uptime_percentage: null" in converter_tools,
        "converter fallback tools must not invent latency or uptime metrics",
        failures,
    )
    expect(
        'status: "draft"' in converter_tools and "api_endpoint: null" in converter_tools,
        "converter fallback records must remain drafts without synthetic demo endpoints",
        failures,
    )
    converter_service = CONVERTER_SERVICE.read_text(encoding="utf-8")
    expect(
        "_run_demo_once" not in converter_service
        and '"latency_ms"' not in converter_service
        and "Runtime QA requires a deployed tool endpoint" in converter_service,
        "converter QA must never certify simulated calls or report synthetic latency",
        failures,
    )

    seller_server = SELLER_TOOL_SERVER.read_text(encoding="utf-8")
    seller_gateway_auth = SELLER_TOOL_GATEWAY_AUTH.read_text(encoding="utf-8")
    seller_openrouter = SELLER_TOOL_OPENROUTER.read_text(encoding="utf-8")
    seller_vision = SELLER_TOOL_VISION.read_text(encoding="utf-8")
    seller_comprehensive = SELLER_TOOL_COMPREHENSIVE.read_text(encoding="utf-8")
    seller_url_safety = SELLER_TOOL_URL_SAFETY.read_text(encoding="utf-8")
    seller_listing_scraper = SELLER_TOOL_LISTING_SCRAPER.read_text(encoding="utf-8")
    seller_image_service = SELLER_TOOL_IMAGE_SERVICE.read_text(encoding="utf-8")
    expect(
        'app.get("/ready"' in seller_server and "isAnalysisProviderConfigured" in seller_server,
        "seller tool readiness must fail closed when its provider is not configured",
        failures,
    )
    expect(
        'app.use("/api/", requireGatewayRequest)' in seller_server
        and 'app.post("/", requireGatewayRequest)' in seller_server
        and "gatewayVerifier.ready" in seller_server
        and "gateway_authentication" in seller_server,
        "seller tool routes and readiness must enforce gateway authentication",
        failures,
    )
    expect(
        "crypto.verify" in seller_gateway_auth
        and "expectedToolSlug" in seller_gateway_auth
        and "GATEWAY_SIGNATURE_EXPIRED" in seller_gateway_auth
        and "GATEWAY_REQUEST_REPLAYED" in seller_gateway_auth,
        "seller tool must verify signed gateway requests, expiry, tool binding, and replay",
        failures,
    )
    expect(
        "providerNotConfiguredError" in seller_openrouter
        and "providerNotConfiguredError" in seller_vision
        and "generateDynamicAnalysis" not in seller_openrouter
        and "generateDynamicAnalysis" not in seller_vision,
        "seller tool provider failures must never return synthetic analysis",
        failures,
    )
    expect(
        "successfulVisionResults.length === 0" in seller_comprehensive
        and "throw error" in seller_comprehensive
        and "overall_score: 0" not in seller_comprehensive,
        "seller tool must fail honestly when every provider-backed analysis fails",
        failures,
    )
    expect(
        "assertPublicHttpsUrl" in seller_url_safety
        and "isPublicIpAddress" in seller_url_safety
        and "LISTING_HOST_SUFFIXES" in seller_url_safety,
        "seller tool remote fetches must validate HTTPS hosts and resolved IP addresses",
        failures,
    )
    expect(
        'redirect: "manual"' in seller_listing_scraper
        and "assertSafeRemoteUrl" in seller_listing_scraper
        and "readResponseText" in seller_listing_scraper,
        "listing fetches must revalidate redirects and cap response size",
        failures,
    )
    expect(
        'redirect: "error"' in seller_image_service
        and "assertSafeRemoteUrl" in seller_image_service
        and "readResponseBuffer" in seller_image_service,
        "remote image fetches must block redirects, SSRF targets, and unbounded bodies",
        failures,
    )
    for obsolete_service in ["bedrock-service.js", "gemini-service.js", "openai-service.js"]:
        expect(
            not (SELLER_TOOL_ROOT / "services" / obsolete_service).exists(),
            f"remove obsolete seller tool provider adapter {obsolete_service}",
            failures,
        )
    tools_router = API_TOOLS_ROUTER.read_text(encoding="utf-8")
    expect(
        'settings.environment == "production" and current_user is None' in tools_router,
        "production tool submissions must require a signed-in owner",
        failures,
    )
    expect(
        "_public_tool_response" in tools_router
        and '"environment_variables": None' in tools_router
        and '"api_endpoint": None' in tools_router
        and '"source_s3_key": None' in tools_router
        and '"config_s3_key": None' in tools_router
        and '"source_file_tree": None' in tools_router
        and '"entry_command": None' in tools_router
        and '"processing_error": None' in tools_router,
        "public tool APIs must redact seller secrets, storage keys, source metadata, and raw endpoints",
        failures,
    )
    web_home_page = WEB_HOME_PAGE.read_text(encoding="utf-8")
    web_landing_page = WEB_LANDING_PAGE.read_text(encoding="utf-8")
    expect(
        'api.get<MarketplaceStats>("/tools/stats"' in web_home_page
        and "marketplaceStats={marketplaceStats}" in web_home_page
        and "Live database totals" in web_landing_page,
        "homepage marketplace metrics must come from the live aggregate API",
        failures,
    )
    expect(
        "1,247" not in web_landing_page
        and "$340/month" not in web_landing_page
        and 'value: "15%"' not in web_landing_page
        and 'value: "Weekly"' not in web_landing_page,
        "homepage must not publish fabricated traction, earnings, fees, or payout claims",
        failures,
    )
    web_pricing_page = WEB_PRICING_PAGE.read_text(encoding="utf-8")
    web_seller_agreement = WEB_SELLER_AGREEMENT_PAGE.read_text(encoding="utf-8")
    web_docs = WEB_DOCS_CLIENT.read_text(encoding="utf-8")
    expect(
        'PLATFORM_FEE_RATE = Decimal("0.20")' in billing_service
        and "20% platform fee" in web_pricing_page
        and "20% platform fee" in web_seller_agreement
        and "20% platform fee" in web_docs
        and "15% platform fee" not in web_docs,
        "billing code, pricing, seller terms, and docs must publish the same platform fee",
        failures,
    )
    web_submit_page = WEB_SUBMIT_PAGE.read_text(encoding="utf-8")
    expect(
        '`/tools/${listing.id}/upload`' in web_submit_page
        and '`/tools/${listing.id}/configure`' in web_submit_page,
        "seller submission must persist source and queue durable processing after draft review",
        failures,
    )
    expect(
        "body: SellerToolUpdate" in tools_router
        and "LIVE_LOCKED_SELLER_FIELDS" in tools_router
        and "tool_live_fields_locked" in tools_router,
        "seller edits must not expose operational fields or mutate live pricing contracts",
        failures,
    )
    gateway_router = (REPO_ROOT / "apps" / "api" / "app" / "routers" / "gateway.py").read_text(
        encoding="utf-8"
    )
    expect(
        "_ensure_gateway_entitlement" in gateway_router
        and "OwnershipType.full_sale" in gateway_router
        and "PurchaseStatus.active" in gateway_router,
        "gateway must require active purchases before invoking full-sale tools",
        failures,
    )
    expect(
        "_gateway_error_content" in gateway_router
        and "_attach_gateway_error_context" in gateway_router
        and '"request_id": request_id' in gateway_router
        and '"timeout_seconds": settings.tool_request_timeout_seconds' in gateway_router,
        "gateway-generated tool failure errors must use the standard traceable envelope",
        failures,
    )
    expect(
        "_persist_or_queue_usage_log" in gateway_router
        and "enqueue_usage_log_job" in gateway_router
        and "background_tasks.add_task(usage_service" not in gateway_router,
        "gateway usage accounting must persist synchronously with a durable retry fallback",
        failures,
    )
    expect(
        "Sign in before submitting a tool for analysis" in tools_router,
        "anonymous production submissions must fail before creating system-owned drafts",
        failures,
    )
    internal_router = API_INTERNAL_ROUTER.read_text(encoding="utf-8")
    expect(
        "Public live tools must always be invokable" in internal_router
        and "ToolStatus.live" not in internal_router,
        "internal converter imports must not mark tools live without an invokable endpoint",
        failures,
    )
    expect(
        OPERATIONS_HEALTH_SERVICE.exists(), "shared operations health service is missing", failures
    )
    operations_health_service = OPERATIONS_HEALTH_SERVICE.read_text(encoding="utf-8")
    expect(
        "get_operations_health" in operations_health_service,
        "operations health service must expose shared health summary",
        failures,
    )
    expect(
        "processing_job_check" in operations_health_service,
        "operations health service must centralize processing-job risk classification",
        failures,
    )
    expect(
        "stripe_webhook_check" in operations_health_service,
        "operations health must classify stuck and failed Stripe webhook events",
        failures,
    )
    expect(
        "worker_heartbeat" in api_main and "missing_heartbeat" in api_main,
        "API readiness must expose worker heartbeat status",
        failures,
    )
    expect(
        'openapi_url=debug_only_url("/openapi.json")' in api_main
        and 'docs_url=debug_only_url("/docs")' in api_main
        and 'redoc_url=debug_only_url("/redoc")' in api_main,
        "API docs and raw OpenAPI schema must be debug-only",
        failures,
    )
    expect(
        "INVALID_CONTENT_LENGTH" in api_main
        and "REQUEST_TOO_LARGE" in api_main
        and '"request_id": getattr(request.state, "request_id", get_request_id())' in api_main
        and '"details": {"max_request_body_bytes": settings.max_request_body_bytes}' in api_main,
        "early request body limit errors must use the standard traceable error envelope",
        failures,
    )
    error_handler = (
        REPO_ROOT / "apps" / "api" / "app" / "middleware" / "error_handler.py"
    ).read_text(encoding="utf-8")
    expect(
        "_serializable_validation_errors" in error_handler
        and "SENSITIVE_VALIDATION_ERROR_KEYS" in error_handler
        and "_serializable_validation_errors(exc.errors(), settings.debug)" in error_handler
        and "include_sensitive or key not in SENSITIVE_VALIDATION_ERROR_KEYS" in error_handler,
        "production validation errors must not echo raw submitted input values",
        failures,
    )
    expect(
        "degraded_high_depth" in operations_health_service,
        "shared operations health must degrade when worker queue depth is too high",
        failures,
    )
    expect(
        "operations_health_service.get_operations_health" in api_main,
        "API readiness must use the shared operations health service",
        failures,
    )

    admin_router = API_ADMIN_ROUTER.read_text(encoding="utf-8")
    tools_router = API_TOOLS_ROUTER.read_text(encoding="utf-8")
    expect(
        "operations_health_service.get_operations_health" in admin_router,
        "admin health endpoint must use the shared operations health service",
        failures,
    )
    expect(ADMIN_AUDIT_SERVICE.exists(), "admin audit service is missing", failures)
    admin_audit_service = ADMIN_AUDIT_SERVICE.read_text(encoding="utf-8")
    expect(
        "record_admin_action" in admin_audit_service,
        "admin mutations must have a durable audit recorder",
        failures,
    )
    expect(
        "list_admin_audit_logs" in admin_audit_service,
        "admin dashboard must expose audit history",
        failures,
    )
    expect(
        "record_admin_action" in admin_router,
        "admin mutation routes must record audit actions",
        failures,
    )
    expect(
        '"previous"' in admin_router
        and '"new"' in admin_router
        and "previous_status" in admin_router
        and "previous_role" in admin_router,
        "admin moderation audit logs must capture before and after state",
        failures,
    )
    expect("/audit-logs" in admin_router, "admin API must expose audit logs to admins", failures)
    expect(
        "/stripe-webhooks" in admin_router and "retry_webhook_event" in admin_router,
        "admin API must expose and retry durable Stripe webhook events",
        failures,
    )
    admin_page = WEB_ADMIN_PAGE.read_text(encoding="utf-8")
    expect(
        "Stripe event queue" in admin_page and "retryStripeEvent" in admin_page,
        "admin dashboard must show and retry failed Stripe webhook events",
        failures,
    )

    smoke_check = PRODUCTION_SMOKE_CHECK.read_text(encoding="utf-8")
    expect(
        "check_api_auth_boundary" in smoke_check,
        "smoke checks must verify protected API routes",
        failures,
    )
    expect(
        "parse_json_error" in smoke_check,
        "smoke checks must verify structured API error payloads",
        failures,
    )
    expect(
        "check_api_cors" in smoke_check,
        "smoke checks must verify production CORS behavior",
        failures,
    )
    expect(
        "check_api_debug_routes_closed" in smoke_check,
        "smoke checks must verify production API docs and OpenAPI schema are disabled",
        failures,
    )
    expect(
        "production CSP includes unsafe directives" in smoke_check
        and "strict-transport-security" in smoke_check,
        "smoke checks must reject unsafe production frontend security headers",
        failures,
    )
    expect(
        "check_submission_status_page" in smoke_check,
        "smoke checks must verify submission status pages",
        failures,
    )
    expect(
        "check_admin_operations_health" in smoke_check,
        "smoke checks must verify admin operations health when an admin token is provided",
        failures,
    )
    load_smoke_check = PRODUCTION_LOAD_SMOKE_CHECK.read_text(encoding="utf-8")
    expect(
        "ThreadPoolExecutor" in load_smoke_check,
        "load smoke check must exercise concurrent requests",
        failures,
    )
    expect(
        "gateway invocation" in load_smoke_check,
        "load smoke check must support gateway invocation checks",
        failures,
    )
    expect(
        "public discovery" in load_smoke_check,
        "load smoke check must cover tool discovery under load",
        failures,
    )
    expect(
        "api_origin_url" in smoke_check
        and "rest_api_url" in smoke_check
        and "api_origin_url" in load_smoke_check
        and "rest_api_url" in load_smoke_check
        and "gateway_api_url" in load_smoke_check,
        "production smoke checks must normalize API base URLs before constructing REST and gateway paths",
        failures,
    )

    admin_page = WEB_ADMIN_PAGE.read_text(encoding="utf-8")
    dashboard_page = WEB_DASHBOARD_PAGE.read_text(encoding="utf-8")
    expect(
        "Promise.allSettled" in dashboard_page and "remoteStatuses[mode]" in dashboard_page,
        "buyer and seller dashboard failures must remain isolated",
        failures,
    )
    expect(
        "/admin/operations-health" in admin_page,
        "admin dashboard must load production operations health",
        failures,
    )
    expect("/admin/audit-logs" in admin_page, "admin dashboard must load audit logs", failures)
    expect(
        "Production health" in admin_page,
        "admin dashboard must render production health status",
        failures,
    )
    expect("Audit trail" in admin_page, "admin dashboard must render admin audit trail", failures)

    web_env = WEB_ENV.read_text(encoding="utf-8")
    web_security_headers = WEB_SECURITY_HEADERS.read_text(encoding="utf-8")
    expect(
        'process.env.NODE_ENV !== "production" && CONVERTER_ENABLED' in web_env,
        "frontend must disable converter catalog fallback in production",
        failures,
    )
    expect(
        'ALLOW_PUBLIC_DEMO_API_KEY = process.env.NODE_ENV !== "production"' in web_env,
        "frontend must ignore public demo API keys in production",
        failures,
    )
    expect(
        'converterUrl ?? (isProduction ? null : "http://localhost:8080")' in web_security_headers,
        "frontend production CSP must not include the local converter origin unless configured",
        failures,
    )
    for path in [WEB_HOME_PAGE, WEB_MARKETPLACE_PAGE, WEB_MARKETPLACE_CLIENT, WEB_TOOL_PAGE]:
        source = path.read_text(encoding="utf-8")
        expect(
            "ALLOW_CONVERTER_CATALOG_FALLBACK" in source,
            f"{path.relative_to(REPO_ROOT)} must guard converter catalog fallback",
            failures,
        )
    tool_page = WEB_TOOL_PAGE.read_text(encoding="utf-8")
    expect(
        "demoEndpoint={tool.api_endpoint" not in tool_page,
        "tool pages must not expose raw seller endpoints to browser demos",
        failures,
    )
    expect(
        "ALLOW_CONVERTER_CATALOG_FALLBACK && isConverterTool" in tool_page,
        "direct demo endpoints must stay limited to the development-only converter fallback",
        failures,
    )
    docs_client = WEB_DOCS_CLIENT.read_text(encoding="utf-8")
    web_api_client = WEB_API_CLIENT.read_text(encoding="utf-8")
    web_demo_runner = WEB_DEMO_RUNNER.read_text(encoding="utf-8")
    web_live_benchmark = WEB_LIVE_BENCHMARK.read_text(encoding="utf-8")
    web_file_output = WEB_FILE_OUTPUT.read_text(encoding="utf-8")
    web_image_output = WEB_IMAGE_OUTPUT.read_text(encoding="utf-8")
    web_purchase_button = WEB_PURCHASE_BUTTON.read_text(encoding="utf-8")
    web_marketplace_client = WEB_MARKETPLACE_CLIENT.read_text(encoding="utf-8")
    web_safe_url = WEB_SAFE_URL.read_text(encoding="utf-8")
    expect(
        'REQUEST_ID_HEADER = "X-HackMarket-Request-Id"' in web_api_client
        and "createRequestId" in web_api_client
        and "options.next && !options.token ? null : createRequestId()" in web_api_client
        and "headers[REQUEST_ID_HEADER] = requestId" in web_api_client,
        "frontend API client must attach traceable request IDs without defeating public Next.js caching",
        failures,
    )
    expect(
        "REQUEST_ID_HEADER" in web_demo_runner
        and "createRequestId()" in web_demo_runner
        and "REQUEST_ID_HEADER" in web_live_benchmark
        and "createRequestId()" in web_live_benchmark,
        "frontend demo and benchmark calls must attach traceable request IDs",
        failures,
    )
    expect(
        "isTrustedStripeCheckoutUrl" in web_purchase_button
        and 'url.protocol === "https:"' in web_purchase_button
        and 'url.hostname === "checkout.stripe.com"' in web_purchase_button
        and "window.location.assign(purchase.checkout_url)" in web_purchase_button,
        "frontend checkout redirects must be restricted to Stripe Checkout HTTPS URLs",
        failures,
    )
    expect(
        "safeHttpsUrl(value)" in web_file_output
        and "href={downloadUrl}" in web_file_output
        and "safeImageUrl(value)" in web_image_output
        and "safeOutputCssImageUrl(value)" in web_image_output
        and "href={imageUrl}" in web_image_output
        and "backgroundImage" in web_image_output
        and "SAFE_DATA_IMAGE_PATTERN" in web_safe_url
        and "svg" not in web_safe_url,
        "frontend demo file and image outputs must reject unsafe URL schemes",
        failures,
    )
    expect(
        "safeCssImageUrl" in web_safe_url
        and "safeGithubUrl" in web_safe_url
        and 'url.protocol === "https:"' in web_safe_url
        and '"github.com"' in web_safe_url
        and "safeCssImageUrl(tool.seller.avatar_url)" in web_marketplace_client
        and "safeCssImageUrl(tool.seller.avatar_url)" in tool_page
        and "safeGithubUrl(tool.github_url)" in tool_page,
        "frontend must sanitize avatar image URLs and public GitHub links before rendering",
        failures,
    )
    expect(
        "/v1/account/webhooks" not in docs_client,
        "public docs must not advertise the unimplemented account webhooks API",
        failures,
    )
    expect(
        "X-Request-Id" not in docs_client and "X-HackMarket-Request-Id" in docs_client,
        "public docs must use the implemented X-HackMarket-Request-Id tracing header",
        failures,
    )
    expect(
        "It is a tracing key, not an idempotency key" in docs_client,
        "public docs must not promise unsupported idempotent retry caching",
        failures,
    )

    url_safety = URL_SAFETY.read_text(encoding="utf-8")
    expect(
        "validate_public_tool_endpoint" in url_safety,
        "API must validate outbound seller tool URLs",
        failures,
    )
    expect(
        "is_private" in url_safety and "is_loopback" in url_safety,
        "URL safety must reject private/loopback IPs",
        failures,
    )
    expect(
        "getaddrinfo" in url_safety,
        "URL safety must resolve hostnames before outbound tool calls",
        failures,
    )
    expect(
        "validate_public_tool_endpoint_async" in url_safety and "to_thread" in url_safety,
        "URL safety DNS checks must not block the async request path",
        failures,
    )
    expect(
        "https" in url_safety,
        "URL safety must require HTTPS tool endpoints in production",
        failures,
    )

    proxy_service = PROXY_SERVICE.read_text(encoding="utf-8")
    gateway_signing = GATEWAY_SIGNING.read_text(encoding="utf-8")
    render_service = RENDER_SERVICE.read_text(encoding="utf-8")
    expect(
        "SENSITIVE_REQUEST_HEADERS" in proxy_service
        and "authorization" in proxy_service
        and "cookie" in proxy_service
        and "x-forwarded-for" in proxy_service
        and "x-real-ip" in proxy_service,
        "tool proxy must not forward user credentials or client network identity headers to seller tools",
        failures,
    )
    expect(
        "SENSITIVE_RESPONSE_HEADERS" in proxy_service and "set-cookie" in proxy_service,
        "tool proxy must not return seller Set-Cookie headers to buyers",
        failures,
    )
    expect(
        "INTERNAL_GATEWAY_HEADERS" in proxy_service
        and "sign_gateway_request" in proxy_service
        and 'url.raw_path.decode("ascii")' in proxy_service,
        "tool proxy must replace forged platform headers and sign the exact upstream target",
        failures,
    )
    expect(
        "Ed25519PrivateKey" in gateway_signing
        and "SIGNATURE_VERSION" in gateway_signing
        and "build_canonical_message" in gateway_signing
        and "request_target" in gateway_signing,
        "gateway signatures must use Ed25519 and bind the request target",
        failures,
    )
    expect(
        "public_key_from_private" in render_service
        and '"HACKMARKET_GATEWAY_PUBLIC_KEY"' in render_service
        and '"ALLOW_UNSIGNED_GATEWAY_REQUESTS": "false"' in render_service
        and '"TOOL_GATEWAY_SIGNING_PRIVATE_KEY"' not in render_service,
        "hosted seller tools must receive public verification material without the private key",
        failures,
    )

    source_archive = SOURCE_ARCHIVE.read_text(encoding="utf-8")
    container_service = CONTAINER_SERVICE.read_text(encoding="utf-8")
    expect("stat.S_ISLNK" in source_archive, "source ZIP validation must reject symlinks", failures)
    expect(
        "PureWindowsPath" in source_archive,
        "source ZIP validation must reject Windows absolute and traversal paths",
        failures,
    )
    expect(
        "duplicate file paths" in source_archive,
        "source ZIP validation must reject normalized duplicate paths",
        failures,
    )
    expect(
        "extract_safe_zip" in container_service,
        "worker source extraction must use the shared safe ZIP extractor",
        failures,
    )
    expect(
        "extractall" not in container_service,
        "worker source extraction must not use zipfile.extractall",
        failures,
    )
    expect(
        "unpack_archive" not in container_service,
        "worker source extraction must not use shutil.unpack_archive",
        failures,
    )
    expect(
        "tool.status = ToolStatus.live" not in container_service
        and "status=ToolStatus.live" not in API_TOOLS_ROUTER.read_text(encoding="utf-8")
        and "body.status == ToolStatus.live" in API_ADMIN_ROUTER.read_text(encoding="utf-8"),
        "only an administrator review may promote a processed tool to live",
        failures,
    )

    auth_service = (REPO_ROOT / "apps" / "api" / "app" / "services" / "auth_service.py").read_text(
        encoding="utf-8"
    )
    auth_router = (REPO_ROOT / "apps" / "api" / "app" / "routers" / "auth.py").read_text(
        encoding="utf-8"
    )
    auth_dependencies = (REPO_ROOT / "apps" / "api" / "app" / "dependencies.py").read_text(
        encoding="utf-8"
    )
    api_config = API_CONFIG.read_text(encoding="utf-8")
    expect(
        "clerk_issuer_url" in api_config
        and "CLERK_ISSUER_URL" in api_config
        and "issuer=settings.clerk_issuer_url.rstrip" in auth_dependencies,
        "Clerk JWT validation must be pinned to the configured production issuer",
        failures,
    )
    expect(
        'settings.environment != "production"' in auth_service and "profile.email" in auth_service,
        "client-provided auth sync email must only be a non-production fallback",
        failures,
    )
    expect(
        "_safe_avatar_url" in auth_service
        and 'parsed.scheme == "https"' in auth_service
        and "profile.avatar_url" in auth_service
        and "identity.avatar_url" in auth_service,
        "auth sync must sanitize stored avatar URLs before frontend rendering",
        failures,
    )
    expect(
        "_handle_user_created" in auth_router
        and "_handle_user_updated" in auth_router
        and "sync_user_from_identity" in auth_router
        and 'avatar_url=clerk_user.get("image_url")' in auth_router
        and ".values(avatar_url" not in auth_router,
        "Clerk webhooks must route avatar updates through auth sync sanitization",
        failures,
    )
    expect(
        "Verified account email is required" in auth_router,
        "auth sync must fail cleanly when verified Clerk identity has no email",
        failures,
    )

    tool_service = TOOL_SERVICE.read_text(encoding="utf-8")
    expect(
        "flush_total_requests_if_needed" in tools_router,
        "public demos must flush request counters for durable production metrics",
        failures,
    )
    expect(
        "raise ToolNotLiveError(slug)" in tools_router
        and "docs_service.generate_tool_docs(tool)" in tools_router
        and "public_api_base_url=str(request.base_url)" not in tools_router,
        "public tool docs must only expose live tools and use configured public API URLs",
        failures,
    )
    docs_service = (REPO_ROOT / "apps" / "api" / "app" / "services" / "docs_service.py").read_text(
        encoding="utf-8"
    )
    expect(
        "_gateway_api_base" in docs_service
        and 'base.endswith("/v1")' in docs_service
        and 'base.endswith("/api/v1")' in docs_service
        and 'endpoint_url = f"{_gateway_api_base(public_api_base_url)}/tools/{tool.slug}"'
        in docs_service,
        "generated tool docs must normalize PUBLIC_API_BASE_URL before publishing gateway URLs",
        failures,
    )
    expect(
        "getdel" in tool_service,
        "request counter flushes must atomically drain Redis before writing to Postgres",
        failures,
    )

    expect(
        "python scripts/security_scan.py" in ci_workflow,
        "CI must scan tracked files for secrets",
        failures,
    )
    expect(
        "pip-audit -r requirements.txt" in ci_workflow,
        "CI must audit backend runtime dependencies",
        failures,
    )
    expect("ruff check app tests" in ci_workflow, "CI must enforce backend linting", failures)
    expect(
        "ruff format --check app tests" in ci_workflow,
        "CI must enforce backend formatting",
        failures,
    )
    expect("npm run test:e2e" in ci_workflow, "CI must run frontend browser tests", failures)
    expect(
        "python ../../scripts/check_migration_safety.py" in ci_workflow,
        "CI must scan Alembic upgrades for destructive migration operations",
        failures,
    )
    expect(
        "python ../../scripts/check_alembic_migrations.py --upgrade" in ci_workflow,
        "CI must validate Alembic upgrades against a disposable Postgres database",
        failures,
    )
    expect(
        "python scripts/repo_hygiene_check.py" in ci_workflow,
        "CI must block committed build artifacts and local files",
        failures,
    )
    expect(
        "npm audit --audit-level=high" in ci_workflow, "CI must audit Node dependencies", failures
    )
    expect(
        "npm run test:env" in ci_workflow, "CI must test frontend environment validation", failures
    )
    expect(
        "npm run test:security" in ci_workflow, "CI must test frontend security headers", failures
    )
    expect("npm run build" in ci_workflow, "CI must build the frontend", failures)

    validate_env_test = (
        REPO_ROOT / "apps" / "web" / "scripts" / "validate-env.test.mjs"
    ).read_text(encoding="utf-8")
    expect(
        "NEXT_PUBLIC_DEMO_API_KEY must not be set" in validate_env_test,
        "frontend env tests must reject public demo API keys in deploy builds",
        failures,
    )
    expect(
        "rejects test Clerk keys in deploy builds" in validate_env_test
        and "must use a live Clerk key in deploy builds"
        in (REPO_ROOT / "apps" / "web" / "scripts" / "validate-env.mjs").read_text(
            encoding="utf-8"
        ),
        "frontend deploy env validation must reject test-mode Clerk keys",
        failures,
    )

    launch_checklist = PRODUCTION_LAUNCH_CHECKLIST.read_text(encoding="utf-8")
    expect(
        "production_load_smoke_check.py" in launch_checklist,
        "launch checklist must require the production load smoke check",
        failures,
    )

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
        expect(
            not (REPO_ROOT / legacy_path).exists(),
            f"remove stale blueprint file {legacy_path}",
            failures,
        )


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
