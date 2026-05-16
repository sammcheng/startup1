#!/usr/bin/env python3
"""Summarize the repo's intended Render service settings for manual drift checks.

This is intentionally read-only. It gives us a stable report we can compare
against the live Render dashboard when a service was originally created outside
of Blueprint sync and has drifted from `render.yaml`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT_PATH = REPO_ROOT / "render.yaml"
SELLER_TOOL_PACKAGE = (
    REPO_ROOT / "apps" / "seller-tools" / "home-accessibility-checker" / "package.json"
)
SELLER_TOOL_NODE_VERSION = (
    REPO_ROOT / "apps" / "seller-tools" / "home-accessibility-checker" / ".node-version"
)

EXPECTED_WEB_SERVICES: dict[str, dict[str, Any]] = {
    "start": {
        "rootDir": "apps/api",
        "autoDeployTrigger": "checksPass",
        "healthCheckPath": "/health",
        "buildFilter": {"paths": ["apps/api/**"], "ignoredPaths": []},
        "dockerfilePath": "./Dockerfile",
        "dockerContext": ".",
        "envVarKeys": [
            "ENVIRONMENT",
            "DEBUG",
            "DATABASE_URL",
            "REDIS_URL",
            "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "CLERK_SECRET_KEY",
            "CLERK_WEBHOOK_SECRET",
            "CLERK_JWKS_URL",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_REGION",
            "S3_BUCKET_NAME",
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
        ],
        "envVarSpecs": {
            "ENVIRONMENT": {"value": "production"},
            "DEBUG": {"value": "false"},
            "DATABASE_URL": {
                "fromDatabase": {"name": "hackmarket-db", "property": "connectionString"}
            },
            "REDIS_URL": {
                "fromService": {
                    "name": "hackmarket-redis",
                    "type": "keyvalue",
                    "property": "connectionString",
                }
            },
            "STRIPE_SECRET_KEY": {"sync": False},
            "STRIPE_WEBHOOK_SECRET": {"sync": False},
            "CLERK_SECRET_KEY": {"sync": False},
            "CLERK_WEBHOOK_SECRET": {"sync": False},
            "CLERK_JWKS_URL": {"sync": False},
            "AWS_ACCESS_KEY_ID": {"sync": False},
            "AWS_SECRET_ACCESS_KEY": {"sync": False},
            "AWS_REGION": {"value": "us-east-1"},
            "S3_BUCKET_NAME": {"sync": False},
            "OPENAI_API_KEY": {"sync": False},
            "RENDER_API_KEY": {"sync": False},
            "RENDER_OWNER_ID": {"sync": False},
            "RENDER_TOOL_REGION": {"value": "oregon"},
            "RENDER_TOOL_PLAN": {"value": "free"},
            "RENDER_TOOL_AUTO_DEPLOY": {"value": "false"},
            "RENDER_TOOL_HEALTHCHECK_PATH": {"value": "/health"},
            "RENDER_TOOL_DEPLOY_TIMEOUT_SECONDS": {"value": "900"},
            "RENDER_REGISTRY_CREDENTIAL_ID": {"sync": False},
            "RENDER_REGISTRY_CREDENTIAL_NAME": {"value": "hackmarket-ghcr"},
            "IMAGE_REGISTRY_NAMESPACE": {"sync": False},
            "GHCR_USERNAME": {"sync": False},
            "GHCR_TOKEN": {"sync": False},
        },
    },
    "home-accessibility-checker": {
        "rootDir": "apps/seller-tools/home-accessibility-checker",
        "autoDeployTrigger": "checksPass",
        "healthCheckPath": "/health",
        "buildFilter": {
            "paths": ["apps/seller-tools/home-accessibility-checker/**"],
            "ignoredPaths": [],
        },
        "buildCommand": "npm ci",
        "startCommand": "npm start",
        "envVarKeys": [
            "OPENROUTER_API_KEY",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "PUBLIC_APP_URL",
            "LOG_LEVEL",
            "OPENROUTER_TIMEOUT_MS",
            "ANALYSIS_TIMEOUT_MS",
            "MAX_FILE_SIZE",
            "MAX_FILES",
            "MAX_INLINE_IMAGES",
            "LISTING_FETCH_TIMEOUT_MS",
            "REMOTE_IMAGE_FETCH_TIMEOUT_MS",
            "MAX_REMOTE_IMAGE_BYTES",
        ],
        "envVarSpecs": {
            "OPENROUTER_API_KEY": {"sync": False},
            "OPENAI_API_KEY": {"sync": False},
            "GEMINI_API_KEY": {"sync": False},
            "PUBLIC_APP_URL": {"value": "https://hackmarket.io"},
            "LOG_LEVEL": {"value": "info"},
            "OPENROUTER_TIMEOUT_MS": {"value": "20000"},
            "ANALYSIS_TIMEOUT_MS": {"value": "45000"},
            "MAX_FILE_SIZE": {"value": "10485760"},
            "MAX_FILES": {"value": "5"},
            "MAX_INLINE_IMAGES": {"value": "5"},
            "LISTING_FETCH_TIMEOUT_MS": {"value": "10000"},
            "REMOTE_IMAGE_FETCH_TIMEOUT_MS": {"value": "10000"},
            "MAX_REMOTE_IMAGE_BYTES": {"value": "12582912"},
        },
    },
}


def load_blueprint() -> dict[str, Any]:
    return yaml.safe_load(BLUEPRINT_PATH.read_text())


def normalize_service(service: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "name": service.get("name"),
        "type": service.get("type"),
        "runtime": service.get("runtime"),
        "rootDir": service.get("rootDir", ""),
        "autoDeployTrigger": service.get("autoDeployTrigger", "commit"),
        "healthCheckPath": service.get("healthCheckPath", ""),
    }

    build_filter = service.get("buildFilter") or {}
    summary["buildFilter"] = {
        "paths": build_filter.get("paths", []),
        "ignoredPaths": build_filter.get("ignoredPaths", []),
    }

    if service.get("runtime") == "docker":
        summary["dockerfilePath"] = service.get("dockerfilePath", "")
        summary["dockerContext"] = service.get("dockerContext", "")
    else:
        summary["buildCommand"] = service.get("buildCommand", "")
        summary["startCommand"] = service.get("startCommand", "")

    env_keys = []
    env_specs: dict[str, dict[str, Any]] = {}
    for env_var in service.get("envVars", []):
        key = env_var.get("key")
        if key:
            env_keys.append(key)
            spec: dict[str, Any] = {}
            for field in ("value", "sync", "fromDatabase", "fromService"):
                if field in env_var:
                    spec[field] = env_var[field]
            env_specs[key] = spec
    summary["envVarKeys"] = env_keys
    summary["envVarSpecs"] = env_specs

    return summary


def format_text(services: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    lines.append(f"Blueprint: {BLUEPRINT_PATH}")
    lines.append("")
    for service in services:
        lines.append(f"Service: {service['name']}")
        lines.append(f"  Type: {service['type']}")
        lines.append(f"  Runtime: {service['runtime']}")
        lines.append(f"  Root Directory: {service['rootDir'] or '(repo root)'}")
        lines.append(f"  Auto Deploy Trigger: {service['autoDeployTrigger']}")
        lines.append(f"  Health Check Path: {service['healthCheckPath'] or '(unset)'}")
        if service["buildFilter"]["paths"] or service["buildFilter"]["ignoredPaths"]:
            lines.append("  Build Filter:")
            lines.append(
                f"    paths: {service['buildFilter']['paths'] or '[]'}"
            )
            lines.append(
                f"    ignoredPaths: {service['buildFilter']['ignoredPaths'] or '[]'}"
            )
        if service["runtime"] == "docker":
            lines.append(f"  Dockerfile Path: {service['dockerfilePath']}")
            lines.append(f"  Docker Context: {service['dockerContext']}")
        else:
            lines.append(f"  Build Command: {service['buildCommand']}")
            lines.append(f"  Start Command: {service['startCommand']}")
        if service["envVarKeys"]:
            lines.append("  Env Vars:")
            for key in service["envVarKeys"]:
                spec = service["envVarSpecs"].get(key, {})
                if "value" in spec:
                    rendered = f"value={spec['value']!r}"
                elif "sync" in spec:
                    rendered = f"sync={spec['sync']!r}"
                elif "fromDatabase" in spec:
                    rendered = f"fromDatabase={spec['fromDatabase']!r}"
                elif "fromService" in spec:
                    rendered = f"fromService={spec['fromService']!r}"
                else:
                    rendered = "(unspecified)"
                lines.append(f"    - {key}: {rendered}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print the Render service settings encoded in render.yaml."
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of a text report.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if key monorepo safety settings drift from expectations.",
    )
    args = parser.parse_args()

    blueprint = load_blueprint()
    services = [
        normalize_service(service)
        for service in blueprint.get("services", [])
        if service.get("type") == "web"
    ]

    if args.check:
        return validate_services(services)

    if args.json:
        print(json.dumps(services, indent=2))
    else:
        print(format_text(services), end="")

    return 0


def validate_services(services: list[dict[str, Any]]) -> int:
    by_name = {service["name"]: service for service in services}
    errors: list[str] = []

    for service_name, expected in EXPECTED_WEB_SERVICES.items():
        actual = by_name.get(service_name)
        if actual is None:
            errors.append(f"Missing web service '{service_name}' in {BLUEPRINT_PATH}")
            continue

        for key, expected_value in expected.items():
            actual_value = actual.get(key)
            if key == "envVarKeys":
                actual_keys = sorted(actual_value or [])
                expected_keys = sorted(expected_value)
                if actual_keys != expected_keys:
                    errors.append(
                        f"{service_name}.{key} expected {expected_keys!r} but found {actual_keys!r}"
                    )
                continue
            if key == "envVarSpecs":
                actual_specs = actual_value or {}
                for env_key, expected_spec in expected_value.items():
                    actual_spec = actual_specs.get(env_key)
                    if actual_spec != expected_spec:
                        errors.append(
                            f"{service_name}.envVarSpecs[{env_key!r}] expected {expected_spec!r} but found {actual_spec!r}"
                        )
                unexpected_env_specs = sorted(set(actual_specs) - set(expected_value))
                if unexpected_env_specs:
                    errors.append(
                        f"{service_name}.envVarSpecs has unexpected keys {unexpected_env_specs!r}"
                    )
                continue
            if actual_value != expected_value:
                errors.append(
                    f"{service_name}.{key} expected {expected_value!r} but found {actual_value!r}"
                )

    unexpected = sorted(set(by_name) - set(EXPECTED_WEB_SERVICES))
    for service_name in unexpected:
        errors.append(
            f"Unexpected web service '{service_name}' present in {BLUEPRINT_PATH}; update the validation rules if this is intentional."
        )

    errors.extend(validate_seller_tool_runtime_files())

    if errors:
        print("Render blueprint validation failed:", file=sys.stderr)
        for error in errors:
            print(f" - {error}", file=sys.stderr)
        return 1

    print("Render blueprint validation passed.")
    return 0


def validate_seller_tool_runtime_files() -> list[str]:
    errors: list[str] = []

    package = json.loads(SELLER_TOOL_PACKAGE.read_text())
    node_engine = package.get("engines", {}).get("node")
    expected_engine = ">=22 <23"
    if node_engine != expected_engine:
        errors.append(
            f"seller tool package.json engines.node expected {expected_engine!r} but found {node_engine!r}"
        )

    node_version = SELLER_TOOL_NODE_VERSION.read_text().strip()
    expected_version = "22.16.0"
    if node_version != expected_version:
        errors.append(
            f"seller tool .node-version expected {expected_version!r} but found {node_version!r}"
        )

    return errors


if __name__ == "__main__":
    raise SystemExit(main())
