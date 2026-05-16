from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    debug: bool = False
    environment: str = "development"
    cors_origins: list[str] = ["http://localhost:3000", "https://hackmarket.io", "https://www.hackmarket.io"]
    cors_origin_regex: str = r"^https://.*\.vercel\.app$"
    app_base_url: str = "http://localhost:3000"
    public_api_base_url: str = ""
    tool_request_timeout_seconds: int = 30
    max_request_body_bytes: int = 50 * 1024 * 1024  # 50MB

    # Rate limiting
    gateway_rate_limit_per_minute: int = 100
    demo_rate_limit_per_hour: int = 10

    # Database
    database_url: str
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Redis
    redis_url: str = "redis://localhost:6379"
    redis_max_connections: int = 20

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

    # Storage
    local_storage_path: str = "/tmp/hackmarket-storage"

    # Marketplace bootstrap
    enable_bootstrap_tool_seed: bool = False
    bootstrap_tool_api_endpoint: str = ""

    # Render-backed tool deployments
    render_api_key: str = ""
    render_owner_id: str = ""
    render_tool_region: str = "oregon"
    render_tool_plan: str = "free"
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


settings = Settings()
