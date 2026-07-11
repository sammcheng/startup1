from pathlib import Path

import pytest

from app.config import Settings, find_repo_root

PRODUCTION_REQUIRED = {
    "converter_secret": "converter-secret",
    "clerk_secret_key": "sk_live_value",
    "clerk_webhook_secret": "whsec_value",
    "clerk_issuer_url": "https://pleasing-racer-55.clerk.accounts.dev",
    "stripe_secret_key": "sk_live_value",
    "stripe_webhook_secret": "whsec_value",
    "aws_access_key_id": "AKIA_TEST",
    "aws_secret_access_key": "aws-secret",
    "s3_bucket_name": "hackmarket-test",
    "openrouter_api_key": "sk-or-test",
}


def test_repo_root_falls_back_to_api_root_in_shallow_container_layout() -> None:
    assert find_repo_root(Path("/app/app/config.py")) == Path("/app")


def test_repo_root_detects_monorepo_layout(tmp_path: Path) -> None:
    config_path = tmp_path / "apps" / "api" / "app" / "config.py"
    config_path.parent.mkdir(parents=True)
    config_path.touch()

    assert find_repo_root(config_path) == tmp_path


def test_render_postgres_url_uses_asyncpg_driver() -> None:
    settings = Settings(database_url="postgresql://user:secret@db.internal:5432/hackmarket")

    assert settings.database_url == "postgresql+asyncpg://user:secret@db.internal:5432/hackmarket"


def test_asyncpg_postgres_url_is_preserved() -> None:
    database_url = "postgresql+asyncpg://user:secret@db.internal:5432/hackmarket"
    settings = Settings(database_url=database_url)

    assert settings.database_url == database_url


def test_production_requires_core_secrets() -> None:
    with pytest.raises(ValueError, match="Missing required production settings"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
        )


def test_production_requires_https_public_urls() -> None:
    with pytest.raises(ValueError, match="Production public URLs must use https"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="http://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **PRODUCTION_REQUIRED,
        )


def test_production_requires_https_clerk_issuer_url() -> None:
    with pytest.raises(ValueError, match="Production public URLs must use https"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **{
                **PRODUCTION_REQUIRED,
                "clerk_issuer_url": "http://pleasing-racer-55.clerk.accounts.dev",
            },
        )


def test_production_rejects_broad_vercel_cors_regex_by_default() -> None:
    with pytest.raises(ValueError, match="Production CORS must use explicit origins"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="^https://.*\\.vercel\\.app$",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **PRODUCTION_REQUIRED,
        )


def test_production_can_explicitly_allow_vercel_preview_origins() -> None:
    settings = Settings(
        environment="production",
        debug=False,
        app_base_url="https://hackmarket.io",
        public_api_base_url="https://api.hackmarket.io",
        cors_origin_regex="^https://.*\\.vercel\\.app$",
        allow_vercel_preview_origins=True,
        database_url="postgresql://user:secret@db.internal:5432/hackmarket",
        redis_url="redis://redis.internal:6379",
        **PRODUCTION_REQUIRED,
    )

    assert settings.allow_vercel_preview_origins is True


def test_production_settings_accept_required_values() -> None:
    settings = Settings(
        environment="production",
        debug=False,
        app_base_url="https://hackmarket.io",
        public_api_base_url="https://api.hackmarket.io",
        cors_origin_regex="",
        database_url="postgresql://user:secret@db.internal:5432/hackmarket",
        redis_url="redis://redis.internal:6379",
        **PRODUCTION_REQUIRED,
    )

    assert settings.database_url.startswith("postgresql+asyncpg://")


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("clerk_secret_key", "sk_test_value"),
        ("stripe_secret_key", "sk_test_value"),
        ("stripe_secret_key", "rk_test_value"),
    ],
)
def test_production_rejects_test_mode_provider_keys(key: str, value: str) -> None:
    with pytest.raises(ValueError, match="Production provider keys must use live mode"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **{**PRODUCTION_REQUIRED, key: value},
        )


def test_production_rejects_invalid_alert_settings() -> None:
    with pytest.raises(ValueError, match="ALERT_WEBHOOK_TIMEOUT_SECONDS"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            alert_webhook_timeout_seconds=0,
            **PRODUCTION_REQUIRED,
        )


def test_production_rejects_invalid_gateway_abuse_settings() -> None:
    with pytest.raises(ValueError, match="GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            gateway_rate_limit_violation_alert_threshold=0,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="GATEWAY_RATE_LIMIT_VIOLATION_WINDOW_SECONDS"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            gateway_rate_limit_violation_window_seconds=30,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="MAX_ACTIVE_API_KEYS_PER_USER"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            max_active_api_keys_per_user=0,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="ALERT_QUEUE_DEPTH_THRESHOLD"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            alert_queue_depth_threshold=0,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="ALERT_DEDUPE_TTL_SECONDS"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            alert_dedupe_ttl_seconds=30,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            worker_job_timeout_seconds=900,
            alert_processing_job_stale_after_seconds=899,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="ALERT_FAILED_PROCESSING_JOBS_THRESHOLD"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            alert_failed_processing_jobs_threshold=0,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            alert_failed_processing_jobs_window_seconds=59,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="MAX_SOURCE_ZIP_ENTRIES"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            max_source_zip_entries=0,
            **PRODUCTION_REQUIRED,
        )

    with pytest.raises(ValueError, match="MAX_SOURCE_ZIP_UNCOMPRESSED_BYTES"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            max_request_body_bytes=50,
            max_source_zip_uncompressed_bytes=49,
            **PRODUCTION_REQUIRED,
        )


def test_production_rejects_debug_mode() -> None:
    with pytest.raises(ValueError, match="DEBUG must be false"):
        Settings(
            environment="production",
            debug=True,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **PRODUCTION_REQUIRED,
        )


def test_production_rejects_local_database_or_redis_urls() -> None:
    with pytest.raises(ValueError, match="Production service URLs cannot point to localhost"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@localhost:5432/hackmarket",
            redis_url="redis://127.0.0.1:6379",
            **PRODUCTION_REQUIRED,
        )


def test_production_rejects_bootstrap_tool_seed() -> None:
    with pytest.raises(ValueError, match="ENABLE_BOOTSTRAP_TOOL_SEED"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            enable_bootstrap_tool_seed=True,
            **PRODUCTION_REQUIRED,
        )


def test_production_requires_openrouter_unless_fallback_is_explicitly_allowed() -> None:
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        Settings(
            environment="production",
            debug=False,
            app_base_url="https://hackmarket.io",
            public_api_base_url="https://api.hackmarket.io",
            cors_origin_regex="",
            database_url="postgresql://user:secret@db.internal:5432/hackmarket",
            redis_url="redis://redis.internal:6379",
            **{
                key: value
                for key, value in PRODUCTION_REQUIRED.items()
                if key != "openrouter_api_key"
            },
        )

    settings = Settings(
        environment="production",
        debug=False,
        app_base_url="https://hackmarket.io",
        public_api_base_url="https://api.hackmarket.io",
        cors_origin_regex="",
        allow_repo_analysis_fallback=True,
        database_url="postgresql://user:secret@db.internal:5432/hackmarket",
        redis_url="redis://redis.internal:6379",
        **{key: value for key, value in PRODUCTION_REQUIRED.items() if key != "openrouter_api_key"},
    )

    assert settings.allow_repo_analysis_fallback is True
