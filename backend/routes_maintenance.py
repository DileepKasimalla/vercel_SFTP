"""Scheduled cleanup.

Vercel Cron hits this endpoint (see the `crons` block in vercel.json) so that
retention is enforced even when nobody signs in for days. Listing files also
purges opportunistically, so the two together cover both busy and idle portals.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from . import retention
from .config import settings
from .db import get_db
from .schemas import CleanupResult
from .security import bearer_scheme, decode_token
from fastapi.security import HTTPAuthorizationCredentials

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


def _authorize(credentials: HTTPAuthorizationCredentials | None) -> None:
    """Accepts the Vercel Cron secret, or an admin's own access token so the
    sweep can be triggered by hand."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    token = credentials.credentials

    if settings.cron_secret and hmac.compare_digest(token, settings.cron_secret):
        return

    payload = decode_token(token, "access")
    if payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required"
        )


# Vercel Cron issues a GET; POST is here for manual triggering.
@router.api_route("/cleanup", methods=["GET", "POST"], response_model=CleanupResult)
def cleanup(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CleanupResult:
    del request  # signature kept for FastAPI's route inspection
    _authorize(credentials)
    removed = retention.purge_expired(db)
    return CleanupResult(
        deleted=len(removed), files=removed, retention_days=settings.retention_days
    )
