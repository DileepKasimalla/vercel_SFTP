"""Administrator-only endpoints: user management and file uploads."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from . import retention, storage
from .config import settings
from .db import get_db
from .models import FileAssignment, StoredFile, User
from .routes_files import serialize
from .schemas import (
    CreateUserRequest,
    FileOut,
    MessageResponse,
    PasswordIssued,
    ResetPasswordRequest,
    UpdateUserRequest,
    UploadResult,
    UserOut,
)
from .security import generate_password, hash_password, require_admin

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------- users


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[UserOut]:
    users = db.scalars(select(User).order_by(User.role, User.created_at.desc()))
    return [UserOut.model_validate(u) for u in users]


@router.post("/users", response_model=PasswordIssued, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
) -> PasswordIssued:
    username = payload.username.strip().lower()
    if db.scalar(select(User).where(func.lower(User.username) == username)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That username is already taken"
        )

    generated = payload.password is None
    password = payload.password or generate_password()
    user = User(
        username=username,
        email=payload.email,
        full_name=payload.full_name,
        password_hash=hash_password(password),
        role="user",
        is_active=True,
        # Anything the admin issues is temporary until the user replaces it.
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return PasswordIssued(user=UserOut.model_validate(user), password=password, generated=generated)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
) -> UserOut:
    user = _get_managed_user(db, user_id)
    if payload.email is not None:
        user.email = payload.email
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/users/{user_id}/reset-password", response_model=PasswordIssued)
def reset_password(
    user_id: str,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> PasswordIssued:
    user = _get_managed_user(db, user_id)
    generated = payload.password is None
    password = payload.password or generate_password()
    user.password_hash = hash_password(password)
    user.must_change_password = True
    db.commit()
    db.refresh(user)
    return PasswordIssued(user=UserOut.model_validate(user), password=password, generated=generated)


@router.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(user_id: str, db: Session = Depends(get_db)) -> MessageResponse:
    user = _get_managed_user(db, user_id)
    username = user.username
    db.delete(user)
    db.commit()
    return MessageResponse(detail="Deleted " + username)


def _get_managed_user(db: Session, user_id: str) -> User:
    """Guards the user-management endpoints: they operate on portal users only,
    so an admin account can never be reset or deleted through this surface."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Administrator accounts cannot be managed from here",
        )
    return user


# ---------------------------------------------------------------- files


@router.post("/files", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload_files(
    files: list[UploadFile] = File(...),
    notes: str | None = Form(default=None),
    # JSON array of user ids; omit or send [] to share the upload with everyone.
    assigned_user_ids: str | None = Form(default=None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UploadResult:
    target_ids = _parse_assignment_ids(db, assigned_user_ids)
    max_bytes = settings.max_upload_mb * 1024 * 1024

    uploaded: list[FileOut] = []
    failed: list[dict] = []

    for upload in files:
        data = await upload.read()
        await upload.close()
        if not data:
            failed.append({"name": upload.filename, "error": "File is empty"})
            continue
        if len(data) > max_bytes:
            failed.append(
                {
                    "name": upload.filename,
                    "error": "Exceeds the {} MB limit".format(settings.max_upload_mb),
                }
            )
            continue

        try:
            saved = storage.save(
                upload.filename or "file",
                data,
                upload.content_type or "application/octet-stream",
            )
        except Exception as exc:  # noqa: BLE001 - reported per file so one bad upload does not sink the batch
            failed.append({"name": upload.filename, "error": "Storage error: {}".format(exc)})
            continue

        record = StoredFile(
            original_name=upload.filename or saved.storage_key.rsplit("/", 1)[-1],
            content_type=saved.content_type,
            size_bytes=saved.size_bytes,
            backend=saved.backend,
            storage_key=saved.storage_key,
            download_url=saved.download_url,
            notes=notes,
            uploaded_by_id=admin.id,
        )
        record.assignments = [FileAssignment(user_id=uid) for uid in target_ids]
        db.add(record)
        db.commit()
        db.refresh(record)
        uploaded.append(serialize(record))

    if not uploaded and failed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="; ".join(f["name"] + ": " + f["error"] for f in failed),
        )
    return UploadResult(uploaded=uploaded, failed=failed)


@router.get("/files", response_model=list[FileOut])
def list_all_files(db: Session = Depends(get_db)) -> list[FileOut]:
    # Enforce retention here too, so an idle portal still cleans up as soon as
    # an admin looks at it.
    retention.purge_expired(db)
    files = db.scalars(
        select(StoredFile)
        .options(
            selectinload(StoredFile.assignments),
            selectinload(StoredFile.downloads),
            selectinload(StoredFile.uploaded_by),
        )
        .order_by(StoredFile.created_at.desc())
    )
    return [serialize(f) for f in files]


@router.delete("/files/{file_id}", response_model=MessageResponse)
def delete_file(file_id: str, db: Session = Depends(get_db)) -> MessageResponse:
    file = db.get(StoredFile, file_id)
    if file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    name, backend, key = file.original_name, file.backend, file.storage_key
    db.delete(file)
    db.commit()
    # Best effort: the row is already gone, so a storage hiccup here only leaves
    # an orphaned object behind rather than a dangling listing.
    try:
        storage.delete(backend, key)
    except Exception:  # noqa: BLE001
        pass
    return MessageResponse(detail="Deleted " + name)


def _parse_assignment_ids(db: Session, raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        ids = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="assigned_user_ids must be a JSON array of user ids",
        ) from None
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="assigned_user_ids must be a JSON array of user ids",
        )
    ids = list(dict.fromkeys(ids))
    if not ids:
        return []
    found = set(db.scalars(select(User.id).where(User.id.in_(ids), User.role == "user")).all())
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown user id(s): " + ", ".join(missing),
        )
    return ids
