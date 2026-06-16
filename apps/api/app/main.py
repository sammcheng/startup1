import json as _json
import logging
import asyncio
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text as sql_text
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from app.config import settings
from app.middleware.error_handler import setup_error_handlers
from app.request_context import get_request_id, reset_request_id, set_request_id
from app.services import billing_service


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


async def _close_app_resources() -> None:
    from app.dependencies import _redis_client, engine
    from app.services.queue_service import close_arq_pool
    from app.services.proxy_service import close_http_client

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
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
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
    if content_length and int(content_length) > settings.max_request_body_bytes:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "REQUEST_TOO_LARGE",
                    "message": f"Request body exceeds {settings.max_request_body_bytes // (1024 * 1024)}MB limit.",
                }
            },
        )
    return await call_next(request)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = request.headers.get("X-HackMarket-Request-Id") or str(uuid.uuid4())
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
from app.routers import admin, api_keys, auth, billing, dashboard, gateway, internal, seller, tools, upload, usage  # noqa: E402

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
    from app.services import queue_service

    checks: dict = {"database": "ok", "redis": "ok"}
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(sql_text("select 1"))
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    try:
        await _redis_client.ping()
    except Exception as exc:
        checks["redis"] = f"error: {type(exc).__name__}"

    if settings.environment == "production" and checks["redis"] == "ok":
        try:
            depth = await queue_service.queue_depth(_redis_client)
            worker_health = await _redis_client.get(settings.worker_health_check_key)
            checks["queue"] = f"ok depth={depth}"
            checks["worker"] = "ok" if worker_health else "missing_heartbeat"
        except Exception as exc:
            checks["queue"] = f"error: {type(exc).__name__}"

    all_ok = checks.get("database") == "ok" and checks.get("redis") == "ok" and checks.get("queue", "ok").startswith("ok")
    payload = {
        "status": "ready" if all_ok else "degraded",
        "environment": settings.environment,
        "checks": checks,
    }
    return JSONResponse(content=payload, status_code=200 if all_ok else 503)
