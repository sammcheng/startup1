import asyncio
import json as _json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text as sql_text
from starlette.requests import Request

from app.config import settings
from app.middleware.error_handler import setup_error_handlers
from app.request_context import get_request_id, reset_request_id, set_request_id
from app.services import alert_service, billing_service, operations_health_service


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if record.exc_info and record.exc_info[1]:
            log_data["exception"] = self.formatException(record.exc_info)
        return _json.dumps(log_data, default=str)


root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG if settings.debug else logging.INFO)
root_logger.handlers.clear()
handler = logging.StreamHandler()
handler.addFilter(RequestIdFilter())
if settings.environment == "production":
    handler.setFormatter(JSONFormatter())
else:
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s [request_id=%(request_id)s] %(message)s"
    ))
root_logger.addHandler(handler)

logger = logging.getLogger(__name__)

MAX_REQUEST_ID_LENGTH = 128
REQUEST_ID_ALLOWED_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._:-")


def normalize_request_id(value: str | None) -> str:
    if not value:
        return str(uuid.uuid4())
    if len(value) > MAX_REQUEST_ID_LENGTH:
        return str(uuid.uuid4())
    if any(char not in REQUEST_ID_ALLOWED_CHARS for char in value):
        return str(uuid.uuid4())
    return value


def debug_only_url(path: str) -> str | None:
    return path if settings.debug else None


async def _close_app_resources() -> None:
    from app.dependencies import _redis_client, engine
    from app.services.proxy_service import close_http_client
    from app.services.queue_service import close_arq_pool

    try:
        await close_arq_pool()
    except Exception:  # pragma: no cover - best-effort cleanup
        logger.warning("Failed to close ARQ pool cleanly.", exc_info=True)

    try:
        await close_http_client()
    except Exception:  # pragma: no cover - best-effort cleanup
        logger.warning("Failed to close shared HTTP client cleanly.", exc_info=True)

    try:
        await _redis_client.aclose()
    except Exception:  # pragma: no cover - best-effort cleanup
        logger.warning("Failed to close Redis client cleanly.", exc_info=True)

    try:
        await engine.dispose()
    except Exception:  # pragma: no cover - best-effort cleanup
        logger.warning("Failed to dispose SQLAlchemy engine cleanly.", exc_info=True)



@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    logger.info("Starting Hackmarket API (env=%s)", settings.environment)
    scheduler_stop: asyncio.Event | None = None
    scheduler_task: asyncio.Task | None = None
    if settings.environment != "test" and settings.run_billing_scheduler_in_api:
        scheduler_stop = asyncio.Event()
        scheduler_task = asyncio.create_task(billing_service.run_scheduler_loop(scheduler_stop))
    yield
    logger.info("Shutting down...")
    if scheduler_stop is not None and scheduler_task is not None:
        scheduler_stop.set()
        scheduler_task.cancel()
        try:
            await scheduler_task
        except asyncio.CancelledError:
            pass
    await _close_app_resources()
    logger.info("Shutdown complete")


app = FastAPI(
    title="Hackmarket API",
    version="0.1.0",
    openapi_url=debug_only_url("/openapi.json"),
    docs_url=debug_only_url("/docs"),
    redoc_url=debug_only_url("/redoc"),
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
cors_origins = list(settings.cors_origins)
if settings.app_base_url and settings.app_base_url not in cors_origins:
    cors_origins.append(settings.app_base_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Api-Key", "X-HackMarket-Request-Id"],
    expose_headers=[
        "X-HackMarket-Request-Id",
        "X-HackMarket-Response-Time-Ms",
        "X-RateLimit-Remaining",
        "X-RateLimit-Limit",
        "X-Demo-RateLimit-Remaining",
        "X-Demo-RateLimit-Limit",
    ],
    allow_origin_regex=settings.cors_origin_regex or None,
)


@app.middleware("http")
async def enforce_request_body_limit(request: Request, call_next):
    content_length = request.headers.get("content-length")
    try:
        declared_length = int(content_length) if content_length else None
    except ValueError:
        from fastapi.responses import JSONResponse

        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "INVALID_CONTENT_LENGTH",
                    "message": "Content-Length must be a valid integer.",
                    "status": 400,
                    "request_id": getattr(request.state, "request_id", get_request_id()),
                    "details": {},
                }
            },
        )
    if declared_length is not None and declared_length > settings.max_request_body_bytes:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "REQUEST_TOO_LARGE",
                    "message": f"Request body exceeds {settings.max_request_body_bytes // (1024 * 1024)}MB limit.",
                    "status": 413,
                    "request_id": getattr(request.state, "request_id", get_request_id()),
                    "details": {"max_request_body_bytes": settings.max_request_body_bytes},
                }
            },
        )
    return await call_next(request)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = normalize_request_id(request.headers.get("X-HackMarket-Request-Id"))
    request.state.request_id = request_id
    token = set_request_id(request_id)
    start = time.monotonic()
    try:
        response = await call_next(request)
    finally:
        reset_request_id(token)
    elapsed_ms = max(1, int((time.monotonic() - start) * 1000))
    response.headers["X-HackMarket-Request-Id"] = request_id
    response.headers["X-HackMarket-Response-Time-Ms"] = str(elapsed_ms)
    if request.url.path not in ("/health", "/ready"):
        logger.info(
            "%s %s %d %dms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return response

# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
setup_error_handlers(app)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
from app.routers import (  # noqa: E402
    admin,
    api_keys,
    auth,
    billing,
    dashboard,
    gateway,
    internal,
    seller,
    tools,
    upload,
    usage,
)

app.include_router(auth.router, prefix="/v1")
app.include_router(admin.router, prefix="/v1")
app.include_router(tools.router, prefix="/v1")
app.include_router(upload.router, prefix="/v1")
app.include_router(api_keys.router, prefix="/v1")
app.include_router(billing.router, prefix="/v1")
app.include_router(dashboard.router, prefix="/v1")
app.include_router(seller.router, prefix="/v1")
app.include_router(usage.router, prefix="/v1")
app.include_router(internal.router, prefix="/v1")
app.include_router(gateway.router)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "environment": settings.environment, "version": app.version}


@app.get("/ready", tags=["system"])
async def ready():
    from fastapi.responses import JSONResponse

    from app.dependencies import AsyncSessionLocal, _redis_client

    checks: dict = {"database": "ok", "redis": "ok"}
    queue_details: dict | None = None
    processing_job_details: dict | None = None
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(sql_text("select 1"))
            if settings.environment == "production":
                operations_health = await operations_health_service.get_operations_health(session, _redis_client)
                checks.update(operations_health["checks"])
                queue_details = operations_health["queue"]
                processing_job_details = operations_health["processing_jobs"]
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    try:
        await _redis_client.ping()
    except Exception as exc:
        checks["redis"] = f"error: {type(exc).__name__}"

    if settings.environment == "production" and queue_details is not None:
        depth = queue_details["depth"]
        if depth is not None and depth >= settings.alert_queue_depth_threshold:
            await alert_service.send_alert_once(
                _redis_client,
                "queue_depth_high",
                dedupe_key=settings.worker_queue_name,
                ttl_seconds=settings.alert_dedupe_ttl_seconds,
                severity="warning",
                summary=f"Worker queue depth is {depth}.",
                details={
                    "queue": settings.worker_queue_name,
                    "depth": depth,
                    "threshold": settings.alert_queue_depth_threshold,
                },
            )
        if checks.get("worker") == "missing_heartbeat":
            await alert_service.send_alert_once(
                _redis_client,
                "worker_heartbeat_missing",
                dedupe_key=settings.worker_health_check_key,
                ttl_seconds=settings.alert_dedupe_ttl_seconds,
                severity="critical",
                summary="Worker heartbeat is missing from Redis.",
                details={"health_check_key": settings.worker_health_check_key},
            )

    if settings.environment == "production" and processing_job_details is not None and checks.get("processing_jobs") != "ok":
        stuck_active = processing_job_details["stuck_active"]
        failed_recent = processing_job_details["failed_recent"]
        failed_threshold = processing_job_details["failed_threshold"]
        if stuck_active:
            await alert_service.send_alert_once(
                _redis_client,
                "processing_jobs_stuck",
                dedupe_key=f"stuck-active:{settings.alert_processing_job_stale_after_seconds}",
                ttl_seconds=settings.alert_dedupe_ttl_seconds,
                severity="critical",
                summary=f"{stuck_active} processing job(s) appear stuck.",
                details=processing_job_details,
            )
        if failed_recent >= failed_threshold:
            await alert_service.send_alert_once(
                _redis_client,
                "processing_jobs_failed",
                dedupe_key=f"failed-recent:{settings.alert_failed_processing_jobs_window_seconds}",
                ttl_seconds=settings.alert_dedupe_ttl_seconds,
                severity="warning",
                summary=f"{failed_recent} processing job(s) failed recently.",
                details=processing_job_details,
            )

    all_ok = all(value == "ok" for value in checks.values())
    if not all_ok and settings.environment == "production":
        await alert_service.send_alert_once(
            _redis_client,
            "api_readiness_degraded",
            dedupe_key=",".join(f"{key}:{value}" for key, value in sorted(checks.items())),
            ttl_seconds=settings.alert_dedupe_ttl_seconds,
            severity="critical",
            summary="API readiness check is degraded.",
            details={"checks": checks},
        )
    payload = {
        "status": "ready" if all_ok else "degraded",
        "environment": settings.environment,
        "checks": checks,
    }
    if queue_details is not None:
        payload["queue"] = queue_details
    if processing_job_details is not None:
        payload["processing_jobs"] = processing_job_details
    return JSONResponse(content=payload, status_code=200 if all_ok else 503)
