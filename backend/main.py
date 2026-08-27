"""FastAPI application for the FedEx SFTP portal.

Every route lives under /api so the same paths work locally (via the Vite dev
proxy) and on Vercel (where /api/* is rewritten onto this function).
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routes_admin import router as admin_router
from .routes_auth import router as auth_router
from .routes_files import router as files_router
from .routes_maintenance import router as maintenance_router

logger = logging.getLogger("sftp-portal")

app = FastAPI(
    title="FedEx SFTP Portal API",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(maintenance_router, prefix="/api")


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    database_ok = True
    error: str | None = None
    try:
        init_db()
    except Exception as exc:  # noqa: BLE001 - health must answer even when the DB is down
        database_ok = False
        error = str(exc)
        logger.warning("Database unavailable: %s", exc)
    return {
        "status": "ok" if database_ok else "degraded",
        "database": database_ok,
        "storage_backend": settings.storage_backend,
        "error": error,
    }
