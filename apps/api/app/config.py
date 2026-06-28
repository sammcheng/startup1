from pathlib import Path
from urllib.parse import urlparse

from pydantic import BaseModel, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


APP_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Grouped sub-settings (plain BaseModel, not BaseSettings — loaded from the
# flat env vars by the main Settings class and exposed via properties)
# ---------------------------------------------------------------------------


class DatabaseSettings(BaseModel):
    url: str


class RedisSettings(BaseModel):
    url: str


class StripeSettings(BaseModel):
    secret_key: str
    webhook_secret: str


class AWSSettings(BaseModel):
    access_key_id: str
    secret_access_key: str
    region: str
    s3_bucket_name: str


class ClerkSettings(BaseModel):
    secret_key: str
    webhook_secret: str
    jwks_url: str


# ---------------------------------------------------------------------------
# Main settings — loads all env vars; exposes grouped views via properties
# ---------------------------------------------------------------------------


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(REPO_ROOT / ".env"),
            str(APP_DIR / ".env"),
        ),
        extra="ignore",
    )

    # App
    debug: bool = False
    environment: str = "development"
    cors_origins: list[str] = ["http://localhost:3000", "https://hackmarket.io", "https://www.hackmarket.io"]
    cors_origin_regex: str = r"^https://.*\.vercel\.app$"
    allow_vercel_preview_origins: bool = False
    app_base_url: str = "http://localhost:3000"
    public_api_base_url: str = ""
    tool_request_timeout_seconds: int = 30
    max_request_body_bytes: int = 50 * 1024 * 1024  # 50MB
    max_source_zip_entries: int = 500
    max_source_zip_uncompressed_bytes: int = 100 * 1024 * 1024  # 100MB

    # Observability / alerting
    alert_webhook_url: str = ""
    alert_webhook_timeout_seconds: int = 5
    alert_dedupe_ttl_seconds: int = 900
    alert_queue_depth_threshold: int = 100
    alert_processing_job_stale_after_seconds: int = 1800
    alert_failed_processing_jobs_threshold: int = 3
    alert_failed_processing_jobs_window_seconds: int = 900

    # Rate limiting
    gateway_rate_limit_per_minute: int = 100
    gateway_rate_limit_violation_alert_threshold: int = 3
    gateway_rate_limit_violation_window_seconds: int = 3600
    max_active_api_keys_per_user: int = 10
    demo_rate_limit_per_hour: int = 10
    public_rate_limit_per_minute: int = 60

    # Database
    database_url: str
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Redis
    redis_url: str = "redis://localhost:6379"
    redis_max_connections: int = 20

    # Background workers
    worker_queue_name: str = "hackmarket:jobs"
    worker_job_max_attempts: int = 3
    worker_job_timeout_seconds: int = 900
    worker_job_keep_result_seconds: int = 86_400
    worker_concurrency: int = 4
    worker_health_check_interval_seconds: int = 60
    worker_health_check_key: str = "hackmarket:jobs:health"
    run_billing_scheduler_in_api: bool = False

    # Converter service integration
    converter_secret: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Clerk
    clerk_secret_key: str = ""
    clerk_webhook_secret: str = ""  # from Clerk dashboard → Webhooks → Signing Secret
    clerk_jwks_url: str = ""  # e.g. https://<your-clerk-domain>/.well-known/jwks.json

    # AWS
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    s3_bucket_name: str = ""

    # OpenAI
    openai_api_key: str = ""

    # OpenRouter (used by the single-call submit endpoint for repo analysis)
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4"
    openrouter_app_url: str = "https://hackmarket.io"
    openrouter_app_name: str = "Hackmarket"
    allow_repo_analysis_fallback: bool = False

    # Single-call submit: where to clone GitHub repos for analysis
    submit_repo_clone_dir: str = "/tmp/hackmarket-submit-repos"

    # Storage
    local_storage_path: str = "/tmp/hackmarket-storage"

    # Render-backed tool deployments
    render_api_key: str = ""
    render_owner_id: str = ""
    render_tool_region: str = "oregon"
    render_tool_plan: str = "starter"
    render_tool_auto_deploy: bool = False
    render_tool_healthcheck_path: str = "/health"
    render_tool_deploy_timeout_seconds: int = 900
    render_registry_credential_id: str = ""
    render_registry_credential_name: str = "hackmarket-ghcr"
    image_registry_namespace: str = ""
    ghcr_username: str = ""
    ghcr_token: str = ""

    # ---------------------------------------------------------------------------
    # Grouped access
    # ---------------------------------------------------------------------------

    @field_validator("database_url")
    @classmethod
    def use_async_postgres_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.environment != "production":
            return self

        missing = [
            key
            for key, value in {
                "APP_BASE_URL": self.app_base_url,
                "PUBLIC_API_BASE_URL": self.public_api_base_url,
                "DATABASE_URL": self.database_url,
                "REDIS_URL": self.redis_url,
                "CONVERTER_SECRET": self.converter_secret,
                "CLERK_SECRET_KEY": self.clerk_secret_key,
                "CLERK_WEBHOOK_SECRET": self.clerk_webhook_secret,
                "STRIPE_SECRET_KEY": self.stripe_secret_key,
                "STRIPE_WEBHOOK_SECRET": self.stripe_webhook_secret,
                "AWS_ACCESS_KEY_ID": self.aws_access_key_id,
                "AWS_SECRET_ACCESS_KEY": self.aws_secret_access_key,
                "S3_BUCKET_NAME": self.s3_bucket_name,
                "OPENROUTER_API_KEY": self.openrouter_api_key
                if not self.allow_repo_analysis_fallback
                else "fallback-enabled",
            }.items()
            if not value
        ]
        if missing:
            raise ValueError(f"Missing required production settings: {', '.join(missing)}")

        if self.debug:
            raise ValueError("DEBUG must be false in production.")

        if self.alert_webhook_timeout_seconds <= 0:
            raise ValueError("ALERT_WEBHOOK_TIMEOUT_SECONDS must be positive in production.")

        if self.alert_dedupe_ttl_seconds < 60:
            raise ValueError("ALERT_DEDUPE_TTL_SECONDS must be at least 60 in production.")

        if self.alert_queue_depth_threshold < 1:
            raise ValueError("ALERT_QUEUE_DEPTH_THRESHOLD must be at least 1 in production.")

        if self.alert_processing_job_stale_after_seconds < self.worker_job_timeout_seconds:
            raise ValueError(
                "ALERT_PROCESSING_JOB_STALE_AFTER_SECONDS must be at least WORKER_JOB_TIMEOUT_SECONDS in production."
            )

        if self.alert_failed_processing_jobs_threshold < 1:
            raise ValueError("ALERT_FAILED_PROCESSING_JOBS_THRESHOLD must be at least 1 in production.")

        if self.alert_failed_processing_jobs_window_seconds < 60:
            raise ValueError("ALERT_FAILED_PROCESSING_JOBS_WINDOW_SECONDS must be at least 60 in production.")

        if self.gateway_rate_limit_violation_alert_threshold < 1:
            raise ValueError("GATEWAY_RATE_LIMIT_VIOLATION_ALERT_THRESHOLD must be at least 1 in production.")

        if self.gateway_rate_limit_violation_window_seconds < 60:
            raise ValueError("GATEWAY_RATE_LIMIT_VIOLATION_WINDOW_SECONDS must be at least 60 in production.")

        if self.max_active_api_keys_per_user < 1:
            raise ValueError("MAX_ACTIVE_API_KEYS_PER_USER must be at least 1 in production.")

        if self.run_billing_scheduler_in_api:
            raise ValueError("RUN_BILLING_SCHEDULER_IN_API must be false in production; run the worker service instead.")

        if self.max_source_zip_entries < 1:
            raise ValueError("MAX_SOURCE_ZIP_ENTRIES must be at least 1 in production.")

        if self.max_source_zip_uncompressed_bytes < self.max_request_body_bytes:
            raise ValueError("MAX_SOURCE_ZIP_UNCOMPRESSED_BYTES must be at least MAX_REQUEST_BODY_BYTES in production.")

        insecure_urls = [
            key
            for key, value in {
                "APP_BASE_URL": self.app_base_url,
                "PUBLIC_API_BASE_URL": self.public_api_base_url,
            }.items()
            if not value.startswith("https://")
        ]
        if insecure_urls:
            raise ValueError(f"Production public URLs must use https: {', '.join(insecure_urls)}")

        local_service_urls = [
            key
            for key, value in {
                "DATABASE_URL": self.database_url,
                "REDIS_URL": self.redis_url,
            }.items()
            if _is_local_url(value)
        ]
        if local_service_urls:
            raise ValueError(
                "Production service URLs cannot point to localhost: "
                + ", ".join(local_service_urls)
            )

        if (
            self.cors_origin_regex
            and "vercel" in self.cors_origin_regex.lower()
            and not self.allow_vercel_preview_origins
        ):
            raise ValueError(
                "Production CORS must use explicit origins unless ALLOW_VERCEL_PREVIEW_ORIGINS is enabled."
            )

        return self

    @property
    def database(self) -> DatabaseSettings:
        return DatabaseSettings(url=self.database_url)

    @property
    def redis(self) -> RedisSettings:
        return RedisSettings(url=self.redis_url)

    @property
    def stripe(self) -> StripeSettings:
        return StripeSettings(
            secret_key=self.stripe_secret_key,
            webhook_secret=self.stripe_webhook_secret,
        )

    @property
    def aws(self) -> AWSSettings:
        return AWSSettings(
            access_key_id=self.aws_access_key_id,
            secret_access_key=self.aws_secret_access_key,
            region=self.aws_region,
            s3_bucket_name=self.s3_bucket_name,
        )

    @property
    def clerk(self) -> ClerkSettings:
        return ClerkSettings(
            secret_key=self.clerk_secret_key,
            webhook_secret=self.clerk_webhook_secret,
            jwks_url=self.clerk_jwks_url,
        )


def _is_local_url(value: str) -> bool:
    try:
        hostname = urlparse(value).hostname
    except Exception:  # noqa: BLE001
        return False
    return hostname in {"localhost", "127.0.0.1", "::1"}


settings = Settings()
