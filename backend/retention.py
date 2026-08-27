"""File lifecycle rules.

Two independent rules decide how long a file lives:

1. **Retention.** Every file is permanently deleted RETENTION_DAYS (default 5)
   after it was uploaded, downloaded or not. This is a real delete: the database
   row and the stored object both go.

2. **Collected PDFs.** Once a user downloads a PDF, that file disappears from
   *their* dashboard. Other recipients keep seeing it, and nothing is deleted
   early — rule 1 is still what removes the bytes.

Expiry is derived from `created_at` rather than stored in a column, so changing
RETENTION_DAYS takes effect immediately and no migration is needed.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from . import storage
from .config import settings
from .models import FileDownload, StoredFile, User


def expiry_cutoff() -> datetime:
    """Files created before this moment have outlived their retention window."""
    return datetime.now(timezone.utc) - timedelta(days=settings.retention_days)


def expires_at(file: StoredFile) -> datetime:
    created = file.created_at
    if created.tzinfo is None:  # SQLite hands back naive datetimes
        created = created.replace(tzinfo=timezone.utc)
    return created + timedelta(days=settings.retention_days)


def seconds_remaining(file: StoredFile) -> int:
    return max(0, int((expires_at(file) - datetime.now(timezone.utc)).total_seconds()))


def is_pdf_clause() -> ColumnElement[bool]:
    """SQL-side test for 'this is a PDF', by declared type or by extension."""
    return or_(
        StoredFile.content_type == "application/pdf",
        func.lower(StoredFile.original_name).like("%.pdf"),
    )


def is_pdf(file: StoredFile) -> bool:
    return (
        file.content_type == "application/pdf"
        or file.original_name.lower().endswith(".pdf")
    )


def record_download(db: Session, file: StoredFile, user: User) -> None:
    """Mark a file as collected by this user.

    Only portal users count as recipients — an admin previewing a file from the
    admin dashboard must not make it vanish for anyone.
    """
    if user.role != "user":
        return
    already = db.scalar(
        select(FileDownload).where(
            FileDownload.file_id == file.id, FileDownload.user_id == user.id
        )
    )
    if already is not None:
        return
    db.add(FileDownload(file_id=file.id, user_id=user.id))
    db.commit()


def purge_expired(db: Session) -> list[str]:
    """Delete every file past its retention window. Returns the names removed.

    Called opportunistically whenever a file list is requested, and on a
    schedule by the cron endpoint, so retention holds even if nobody signs in.
    """
    expired = list(db.scalars(select(StoredFile).where(StoredFile.created_at < expiry_cutoff())))
    removed: list[str] = []
    for file in expired:
        name, backend, key = file.original_name, file.backend, file.storage_key
        db.delete(file)
        db.commit()
        # Best effort: the row is gone either way, so a storage hiccup only
        # leaves an orphaned object rather than a dangling listing.
        try:
            storage.delete(backend, key)
        except Exception:  # noqa: BLE001
            pass
        removed.append(name)
    return removed
