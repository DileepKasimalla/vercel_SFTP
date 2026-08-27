"""Runtime configuration, read from environment variables.

Local dev reads a .env file at the repo root; on Vercel the values come from
the project's Environment Variables settings.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return None


class Settings:
    def __init__(self) -> None:
        # Neon's Vercel integration injects POSTGRES_URL / DATABASE_URL_UNPOOLED;
        # accept any of them so the app works with a plain DATABASE_URL too.
        self.database_url: str = self._normalise_db_url(
            _first_env(
                "DATABASE_URL",
                "POSTGRES_URL",
                "POSTGRES_PRISMA_URL",
                "DATABASE_URL_UNPOOLED",
                "POSTGRES_URL_NON_POOLING",
            )
            or "postgresql://postgres:postgres@localhost:5432/fedex_sftp"
        )

        self.jwt_secret: str = _first_env("JWT_SECRET") or "dev-only-insecure-secret-change-me"
        self.jwt_algorithm: str = "HS256"
        self.jwt_expire_minutes: int = int(_first_env("JWT_EXPIRE_MINUTES") or 480)
        self.download_token_seconds: int = int(_first_env("DOWNLOAD_TOKEN_SECONDS") or 120)

        # Optional shared secret that must be presented to run the one-time
        # bootstrap. Recommended for public deployments.
        self.bootstrap_token: str | None = _first_env("BOOTSTRAP_TOKEN")

        self.blob_token: str | None = _first_env("BLOB_READ_WRITE_TOKEN")
        backend = (_first_env("STORAGE_BACKEND") or "auto").lower()
        if backend == "auto":
            backend = "blob" if self.blob_token else "local"
        self.storage_backend: str = backend

        self.local_storage_dir: Path = Path(
            _first_env("LOCAL_STORAGE_DIR") or str(REPO_ROOT / "storage")
        )
        self.max_upload_mb: int = int(_first_env("MAX_UPLOAD_MB") or 25)

        # Every file is deleted this many days after it was uploaded, whether or
        # not anyone downloaded it. See retention.py.
        self.retention_days: int = int(_first_env("RETENTION_DAYS") or 5)
        # Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when this is set
        # on the project; the cleanup endpoint requires it.
        self.cron_secret: str | None = _first_env("CRON_SECRET")

        origins = _first_env("CORS_ORIGINS")
        self.cors_origins: list[str] = (
            [o.strip() for o in origins.split(",") if o.strip()]
            if origins
            else ["http://localhost:5173", "http://127.0.0.1:5173"]
        )

    @staticmethod
    def _normalise_db_url(url: str) -> str:
        # SQLAlchemy needs the postgresql:// scheme; providers hand out postgres://
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://") and "sslmode=" not in url:
            host_part = url.split("@")[-1]
            if not host_part.startswith(("localhost", "127.0.0.1")):
                url += ("&" if "?" in url else "?") + "sslmode=require"
        return url

    @property
    def is_blob(self) -> bool:
        return self.storage_backend == "blob"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
