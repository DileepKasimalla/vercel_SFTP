"""File storage abstraction.

local -> a folder on disk (development)
blob  -> Vercel Blob over its REST API (production)

The active backend is chosen in config.py: it is "blob" whenever
BLOB_READ_WRITE_TOKEN is present, otherwise "local".

The blob calls mirror what @vercel/blob sends on the wire: PUT to
"<api>/?pathname=<url-encoded key>" with the store id passed as its own
header alongside the bearer token.

Large files never pass through the API function (Vercel caps request bodies
at ~4.5 MB). Instead the browser uploads straight to Blob with a short-lived
*client token* minted here - see client_upload_token() - and then asks the API
to register the finished object, which head_blob() verifies.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx

from .config import settings

BLOB_API = "https://vercel.com/api/blob"
BLOB_API_VERSION = "12"
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")
# Pathnames the browser may ask a client token for: one flat, already-sanitised
# name under uploads/. Blob appends a random suffix, so collisions are its problem.
CLIENT_UPLOAD_PATH = re.compile(r"uploads/[A-Za-z0-9._-]{1,180}")
CLIENT_TOKEN_SECONDS = 15 * 60


class BlobError(RuntimeError):
    """A Vercel Blob call failed; carries the API's own explanation."""


@dataclass(slots=True)
class SavedObject:
    backend: str
    storage_key: str
    download_url: str | None
    size_bytes: int
    content_type: str


@dataclass(slots=True)
class BlobInfo:
    url: str
    download_url: str
    pathname: str
    size_bytes: int
    content_type: str


def safe_filename(name: str) -> str:
    name = unicodedata.normalize("NFKD", name or "file").encode("ascii", "ignore").decode()
    name = _UNSAFE.sub("_", name).strip("._") or "file"
    return name[:180]


def _object_path(filename: str) -> str:
    return f"uploads/{secrets.token_hex(8)}-{safe_filename(filename)}"


def _store_id(token: str) -> str:
    """Read-write tokens are "vercel_blob_rw_<storeId>_<secret>"."""
    parts = token.split("_")
    return parts[3] if len(parts) > 3 else ""


def _blob_headers() -> dict[str, str]:
    token = settings.blob_token or ""
    headers = {
        "authorization": f"Bearer {token}",
        "x-api-version": BLOB_API_VERSION,
    }
    store_id = _store_id(token)
    if store_id:
        headers["x-vercel-blob-store-id"] = store_id
    return headers


def _blob_error(response: httpx.Response) -> BlobError:
    try:
        payload = response.json().get("error") or {}
        detail = payload.get("message") or payload.get("code") or response.text
    except ValueError:
        detail = response.text
    # The store id is not a secret - it is the hostname of every blob in the
    # store - and naming it turns "Store not found" into a one-glance diagnosis.
    store = _store_id(settings.blob_token or "") or "<none>"
    return BlobError(f"Vercel Blob {response.status_code}: {detail} (store {store})".strip())


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
        f"{BLOB_API}/?pathname={quote(key, safe='')}",
        content=data,
        headers={
            **_blob_headers(),
            "x-content-type": content_type,
            "x-vercel-blob-access": "public",
            "x-add-random-suffix": "1",
            "x-cache-control-max-age": "31536000",
        },
        timeout=60.0,
    )
    if response.is_error:
        raise _blob_error(response)
    body = response.json()
    return SavedObject(
        backend="blob",
        storage_key=body["url"],
        download_url=body.get("downloadUrl") or body["url"],
        size_bytes=len(data),
        content_type=content_type,
    )


def client_upload_token(pathname: str, max_bytes: int) -> str:
    """Mint a Vercel Blob client token: the same "vercel_blob_client_<store>_<b64>"
    string @vercel/blob's generateClientTokenFromReadWriteToken() produces, so the
    browser can PUT to Blob directly via @vercel/blob/client. The constraints ride
    inside the signed payload, so Blob itself enforces the size cap and the path."""
    token = settings.blob_token or ""
    store_id = _store_id(token)
    if not store_id:
        raise BlobError("BLOB_READ_WRITE_TOKEN is missing or malformed")
    if not CLIENT_UPLOAD_PATH.fullmatch(pathname):
        raise ValueError("Invalid upload pathname")

    claims = {
        "pathname": pathname,
        "maximumSizeInBytes": max_bytes,
        "addRandomSuffix": True,
        "cacheControlMaxAge": 31536000,
        "validUntil": int(time.time() * 1000) + CLIENT_TOKEN_SECONDS * 1000,
    }
    payload = base64.b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode()
    signature = hmac.new(token.encode(), payload.encode(), hashlib.sha256).hexdigest()
    secured = base64.b64encode(f"{signature}.{payload}".encode()).decode()
    return f"vercel_blob_client_{store_id}_{secured}"


def head_blob(url: str) -> BlobInfo:
    """Look a blob up by URL, refusing anything outside our store or the
    uploads/ prefix so a registration call cannot point at a foreign object."""
    store_id = _store_id(settings.blob_token or "")
    host = urlparse(url).hostname or ""
    if not store_id or not host.endswith(".blob.vercel-storage.com") or store_id not in host:
        raise ValueError("That URL is not in this portal's blob store")

    response = httpx.get(
        f"{BLOB_API}?url={quote(url, safe='')}",
        headers=_blob_headers(),
        timeout=30.0,
    )
    if response.is_error:
        raise _blob_error(response)
    body = response.json()
    pathname = body.get("pathname") or ""
    if not pathname.startswith("uploads/"):
        raise ValueError("That blob was not created through the upload flow")
    return BlobInfo(
        url=body["url"],
        download_url=body.get("downloadUrl") or body["url"],
        pathname=pathname,
        size_bytes=int(body.get("size") or 0),
        content_type=body.get("contentType") or "application/octet-stream",
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
            headers=_blob_headers(),
            timeout=30.0,
        )
        return
    try:
        local_path(storage_key).unlink(missing_ok=True)
    except ValueError:
        pass
