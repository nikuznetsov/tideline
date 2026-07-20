from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text

from app.api.v1 import admin, allocations, auth, capacity, export, members, projects, share, timeline, weeks
from app.bootstrap import ensure_bootstrap
from app.core.config import get_settings
from app.core.observability import (
    ALLOCATIONS_TOTAL,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    metrics_response,
    setup_logging,
)
from app.db.models import Allocation
from app.db.session import get_session_factory


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    if settings.sentry_dsn:
        try:
            import sentry_sdk

            sentry_sdk.init(dsn=settings.sentry_dsn)
        except ImportError:
            pass
    async with get_session_factory()() as db:
        await ensure_bootstrap(db)
    yield


app = FastAPI(title="xOps Tideline", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestContextMiddleware)

api = FastAPI(title="xOps Tideline API")
for router_module in (auth, timeline, allocations, capacity, members, projects, weeks, export, share, admin):
    api.include_router(router_module.router)
api.include_router(share.public_router)
app.mount("/api/v1", api)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    try:
        async with get_session_factory()() as db:
            await db.execute(text("SELECT 1"))
            count = (
                await db.execute(select(func.count()).select_from(Allocation))
            ).scalar()
            ALLOCATIONS_TOTAL.set(count or 0)
    except Exception as e:
        return JSONResponse({"status": "error", "detail": str(e)}, status_code=503)
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    return metrics_response()


# ---------- SPA fallback ----------

static_dir = Path(__file__).resolve().parent.parent / get_settings().static_dir
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    if (static_dir / "fonts").exists():
        app.mount("/fonts", StaticFiles(directory=static_dir / "fonts"), name="fonts")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        file = static_dir / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(static_dir / "index.html")
