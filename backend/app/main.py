from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text

from fastapi import APIRouter

from app.api.v1 import admin, allocations, auth, calendar, capacity, export, members, projects, share, timeline, weeks, workspaces
from app.bootstrap import ensure_bootstrap
from app.core.config import get_settings
from app.core.observability import (
    ALLOCATIONS_TOTAL,
    BACKUP_LAST_SUCCESS,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
    metrics_response,
    setup_logging,
)
from app.db.models import Allocation, AuditLog
from app.db.session import get_session_factory


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    # в продакшене (https) дефолтные секреты недопустимы: сессии подделываемы,
    # а админ входит по общеизвестному паролю
    if settings.app_base_url.startswith("https"):
        if settings.secret_key == "dev-secret-change-me":
            raise RuntimeError("SECRET_KEY не задан для продакшена")
        if settings.admin_password == "admin":
            raise RuntimeError("ADMIN_PASSWORD не задан для продакшена")
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
# без пространства: аутентификация, список пространств, вступление, публичные срезы
api.include_router(auth.router)
api.include_router(workspaces.router)
api.include_router(share.public_router)
api.include_router(admin.router)  # /admin/backups — глобальный

# доменные маршруты — только внутри пространства: /api/v1/w/{workspace_slug}/...
workspace_scoped = APIRouter(prefix="/w/{workspace_slug}")
for router_module in (timeline, allocations, capacity, members, projects, weeks, export, calendar):
    workspace_scoped.include_router(router_module.router)
workspace_scoped.include_router(share.router)
workspace_scoped.include_router(admin.audit_router)
api.include_router(workspace_scoped)
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
    from datetime import timezone as tz

    try:
        async with get_session_factory()() as db:
            last_backup = (
                await db.execute(
                    select(AuditLog.created_at)
                    .where(
                        AuditLog.entity_type == "backup",
                        AuditLog.action == "backup_ok",
                    )
                    .order_by(AuditLog.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if last_backup:
                if last_backup.tzinfo is None:
                    last_backup = last_backup.replace(tzinfo=tz.utc)
                BACKUP_LAST_SUCCESS.set(last_backup.timestamp())
    except Exception:
        pass  # метрики не должны падать из-за БД
    return metrics_response()


# ---------- SPA fallback ----------

static_dir = Path(__file__).resolve().parent.parent / get_settings().static_dir
if static_dir.exists():
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    if (static_dir / "fonts").exists():
        app.mount("/fonts", StaticFiles(directory=static_dir / "fonts"), name="fonts")

    static_root = static_dir.resolve()

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        index = static_root / "index.html"
        if full_path:
            candidate = (static_root / full_path).resolve()
            # не выпускаем за пределы static: %2e%2e и прочие обходы
            if candidate.is_relative_to(static_root) and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(index)
