from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assignments: Mapped[list["FileAssignment"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    downloads: Mapped[list["FileDownload"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class StoredFile(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    original_name: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # "local" or "blob"
    backend: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    # relative path for local storage, absolute blob URL for Vercel Blob
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    download_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    uploaded_by: Mapped["User | None"] = relationship(foreign_keys=[uploaded_by_id])
    assignments: Mapped[list["FileAssignment"]] = relationship(
        back_populates="file", cascade="all, delete-orphan"
    )
    downloads: Mapped[list["FileDownload"]] = relationship(
        back_populates="file", cascade="all, delete-orphan"
    )

    @property
    def is_shared_with_everyone(self) -> bool:
        return len(self.assignments) == 0


class FileAssignment(Base):
    """Restricts a file to specific users. No rows for a file == visible to all users."""

    __tablename__ = "file_assignments"
    __table_args__ = (UniqueConstraint("file_id", "user_id", name="uq_file_user"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    file_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    file: Mapped["StoredFile"] = relationship(back_populates="assignments")
    user: Mapped["User"] = relationship(back_populates="assignments")


class FileDownload(Base):
    """One row per (file, user) the first time that user downloads the file.

    Drives the "a PDF disappears from your dashboard once you have it" rule, and
    lets the admin see who has collected what.
    """

    __tablename__ = "file_downloads"
    __table_args__ = (UniqueConstraint("file_id", "user_id", name="uq_download_file_user"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    file_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    downloaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    file: Mapped["StoredFile"] = relationship(back_populates="downloads")
    user: Mapped["User"] = relationship(back_populates="downloads")
