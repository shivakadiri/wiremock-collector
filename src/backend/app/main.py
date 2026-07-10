import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.config import settings
from app.database import Base, SessionLocal, engine
from app.schema_migrate import ensure_schema
from app.services.discovery import sync_discovered_instances
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await ensure_schema(conn)
    start_scheduler()
    if settings.docker_auto_discover_on_startup:
        try:
            async with SessionLocal() as session:
                result = await sync_discovered_instances(session)
                logger.info(
                    "Startup Docker discovery: scanned=%s added=%s updated=%s errors=%s",
                    result.scanned,
                    len(result.added),
                    len(result.updated),
                    result.errors,
                )
        except Exception:
            logger.exception("Startup Docker discovery failed")
    yield
    stop_scheduler()
    await engine.dispose()


app = FastAPI(title="WireMock Collector", lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

static_path = Path(settings.static_dir) if settings.static_dir else Path(__file__).resolve().parent.parent / "static"
if static_path.is_dir() and (static_path / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # API routes are registered first; this catches UI paths
        file = static_path / full_path
        if full_path and file.is_file():
            return FileResponse(file)
        return FileResponse(static_path / "index.html")
