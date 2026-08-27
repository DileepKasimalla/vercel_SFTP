"""File listing and download, shared by both portals."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import retention, storage
from .config import settings
from .db import get_db
from .models import FileAssignment, FileDownload, StoredFile, User
from .schemas import DownloadLink, FileOut
from .security import create_download_token, get_current_user, user_from_download_token

router = APIRouter(tags=["files"])


def serialize(file: StoredFile, viewer: User | None = None) -> FileOut:
    downloads = file.downloads
    return FileOut(
        id=file.id,
        original_name=file.original_name,
        content_type=file.content_type,
        size_bytes=file.size_bytes,
        notes=file.notes,
        created_at=file.created_at,
        uploaded_by=file.uploaded_by.username if file.uploaded_by else None,
        shared_with_everyone=not file.assignments,
        assigned_user_ids=[a.user_id for a in file.assignments],
        expires_at=retention.expires_at(file),
        seconds_remaining=retention.seconds_remaining(file),
        is_pdf=retention.is_pdf(file),
        downloaded_by_me=bool(viewer) and any(d.user_id == viewer.id for d in downloads),
        download_count=len(downloads),
    )


def _base_query():
    return (
        select(StoredFile)
        .options(
            selectinload(StoredFile.assignments),
            selectinload(StoredFile.downloads),
            selectinload(StoredFile.uploaded_by),
        )
        .order_by(StoredFile.created_at.desc())
    )


def visible_files(db: Session, user: User) -> list[StoredFile]:
    """Admins see everything.

    A user sees files shared with everyone plus files assigned to them, minus
    any PDF they have already downloaded — collecting a PDF takes it off your
    dashboard, without affecting anyone else's.
    """
    query = _base_query()
    if user.role == "admin":
        return list(db.scalars(query))

    assigned_to_me = select(FileAssignment.file_id).where(FileAssignment.user_id == user.id)
    has_any_assignment = select(FileAssignment.file_id)
    collected_by_me = select(FileDownload.file_id).where(FileDownload.user_id == user.id)

    query = query.where(
        StoredFile.id.in_(assigned_to_me) | StoredFile.id.not_in(has_any_assignment)
    ).where(~(retention.is_pdf_clause() & StoredFile.id.in_(collected_by_me)))
    return list(db.scalars(query))


def _authorized_file(db: Session, user: User, file_id: str) -> StoredFile:
    file = db.get(StoredFile, file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    if retention.seconds_remaining(file) == 0:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This file has passed its retention window and is being removed",
        )
    if user.role != "admin":
        assignments = file.assignments
        if assignments and all(a.user_id != user.id for a in assignments):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this file",
            )
    return file


@router.get("/files", response_model=list[FileOut])
def list_files(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[FileOut]:
    # Enforce retention on the way in, so expired files never get listed even if
    # the scheduled sweep has not run yet.
    retention.purge_expired(db)
    return [serialize(f, user) for f in visible_files(db, user)]


@router.post("/files/{file_id}/download-link", response_model=DownloadLink)
def download_link(
    file_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DownloadLink:
    """Browsers cannot attach an Authorization header to a plain navigation, so
    the client asks for a short-lived, single-file token first."""
    file = _authorized_file(db, user, file_id)
    token = create_download_token(user, file.id)
    return DownloadLink(
        url=f"/api/files/{file.id}/download?t={quote(token)}",
        expires_in=settings.download_token_seconds,
    )


@router.get("/files/{file_id}/download")
def download(file_id: str, request: Request, db: Session = Depends(get_db)):
    user = user_from_download_token(request, file_id, db)
    file = _authorized_file(db, user, file_id)

    if file.backend == "blob":
        # Serverless responses are size-capped, so hand the browser straight to
        # the blob's own (unguessable) URL instead of proxying the bytes. The
        # download is recorded before the redirect — the last point we control.
        target = file.download_url or file.storage_key
        retention.record_download(db, file, user)
        return RedirectResponse(url=target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    try:
        path = storage.local_path(file.storage_key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid storage key"
        ) from None
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="The stored file is no longer available"
        )

    retention.record_download(db, file, user)
    return FileResponse(path, media_type=file.content_type, filename=file.original_name)
