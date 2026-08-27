"""File storage abstraction.

local -> a folder on disk (development)
blob  -> Vercel Blob over its REST API (production)

The active backend is chosen in config.py: it is "blob" whenever
BLOB_READ_WRITE_TOKEN is present, otherwise "local".
"""
from __future__ import annotations

import re
import secrets
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import settings

BLOB_API = "https://blob.vercel-storage.com"
BLOB_API_VERSION = "7"
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass(slots=True)
class SavedObject:
    backend: str
    storage_key: str
    download_url: str | None
    size_bytes: int
    content_type: str


def safe_filename(name: str) -> str:
    name = unicodedata.normalize("NFKD", name or "file").encode("ascii", "ignore").decode()
    name = _UNSAFE.sub("_", name).strip("._") or "file"
    return name[:180]


def _object_path(filename: str) -> str:
    return f"uploads/{secrets.token_hex(8)}-{safe_filename(filename)}"


def save(filename: str, data: bytes, content_type: str) -> SavedObject:
    content_type = content_type or "application/octet-stream"
    key = _object_path(filename)
    if settings.is_blob:
        return _save_blob(key, data, content_type)
    return _save_local(key, data, content_type)


def _save_local(key: str, data: bytes, content_type: str) -> SavedObject:
    target = settings.local_storage_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return SavedObject("local", key, None, len(data), content_type)


def _save_blob(key: str, data: bytes, content_type: str) -> SavedObject:
    response = httpx.put(
        f"{BLOB_API}/{key}",
        content=data,
        headers={
            "authorization": f"Bearer {settings.blob_token}",
            "x-api-version": BLOB_API_VERSION,
            "x-content-type": content_type,
            "x-add-random-suffix": "1",
            "x-cache-control-max-age": "31536000",
        },
        timeout=60.0,
    )
    response.raise_for_status()
    body = response.json()
    return SavedObject(
        backend="blob",
        storage_key=body["url"],
        download_url=body.get("downloadUrl") or body["url"],
        size_bytes=len(data),
        content_type=content_type,
    )


def local_path(storage_key: str) -> Path:
    """Resolve a stored key inside the storage root, refusing path escapes."""
    root = settings.local_storage_dir.resolve()
    candidate = (root / storage_key).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("Refusing to read outside the storage directory")
    return candidate


def delete(backend: str, storage_key: str) -> None:
    if backend == "blob":
        if not settings.blob_token:
            return
        httpx.post(
            f"{BLOB_API}/delete",
            json={"urls": [storage_key]},
            headers={
                "authorization": f"Bearer {settings.blob_token}",
                "x-api-version": BLOB_API_VERSION,
            },
            timeout=30.0,
        )
        return
    try:
        local_path(storage_key).unlink(missing_ok=True)
    except ValueError:
        pass
