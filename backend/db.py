"""SQLAlchemy engine/session wiring.

Serverless functions get a fresh process per cold start and may be frozen
between invocations, so we disable pooling and pre-ping every checkout.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

engine = create_engine(
    settings.database_url,
    poolclass=NullPool,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


_schema_ready = False


def init_db() -> None:
    """Create tables on first use.

    The schema is small and additive, so create_all is enough here; swap in
    Alembic if the model set grows.
    """
    global _schema_ready
    if _schema_ready:
        return
    from . import models  # noqa: F401  (register mappers before create_all)

    Base.metadata.create_all(bind=engine)
    _schema_ready = True


def get_db() -> Iterator[Session]:
    init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
