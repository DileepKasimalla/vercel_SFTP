"""Password hashing, JWT issuing/verification and FastAPI auth dependencies."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import string
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User

# PBKDF2-HMAC-SHA256 keeps hashing in the standard library: no native wheels to
# build, which matters for a serverless deploy.
_PBKDF2_ITERATIONS = 260_000
_PBKDF2_PREFIX = "pbkdf2_sha256"

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return "{}${}${}${}".format(
        _PBKDF2_PREFIX,
        _PBKDF2_ITERATIONS,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        prefix, iterations, salt_b64, digest_b64 = stored.split("$")
        if prefix != _PBKDF2_PREFIX:
            return False
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(expected, actual)


def generate_password(length: int = 14) -> str:
    """Temporary password for admin-created accounts and password resets."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in candidate)
            and any(c.isupper() for c in candidate)
            and any(c.isdigit() for c in candidate)
        ):
            return candidate


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_download_token(user: User, file_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "fid": file_id,
        "typ": "download",
        "iat": now,
        "exp": now + timedelta(seconds=settings.download_token_seconds),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        ) from exc
    if payload.get("typ") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is not valid for this action"
        )
    return payload


def _load_active_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled or missing"
        )
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    payload = decode_token(credentials.credentials, "access")
    return _load_active_user(db, payload["sub"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required"
        )
    return user


def user_from_download_token(request: Request, file_id: str, db: Session) -> User:
    """Downloads are opened by the browser directly, so they carry a short-lived
    token in the query string instead of an Authorization header."""
    token = request.query_params.get("t")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing download token"
        )
    payload = decode_token(token, "download")
    if payload.get("fid") != file_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Token does not match this file"
        )
    return _load_active_user(db, payload["sub"])
