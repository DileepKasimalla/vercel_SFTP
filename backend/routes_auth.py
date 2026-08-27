"""Bootstrap (one-time admin creation), login and session endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import User, utcnow
from .schemas import (
    BootstrapRequest,
    BootstrapStatus,
    ChangePasswordRequest,
    LoginRequest,
    MessageResponse,
    TokenResponse,
    UserOut,
)
from .security import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(tags=["auth"])


def _admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) or 0


@router.get("/bootstrap/status", response_model=BootstrapStatus)
def bootstrap_status(db: Session = Depends(get_db)) -> BootstrapStatus:
    return BootstrapStatus(
        needs_bootstrap=_admin_count(db) == 0,
        requires_token=bool(settings.bootstrap_token),
        storage_backend=settings.storage_backend,
    )


@router.post("/bootstrap", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def bootstrap(payload: BootstrapRequest, db: Session = Depends(get_db)) -> TokenResponse:
    # Closes permanently once an administrator exists.
    if _admin_count(db) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An administrator already exists. Bootstrap is closed.",
        )
    if settings.bootstrap_token and payload.bootstrap_token != settings.bootstrap_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid bootstrap token"
        )

    username = payload.username.strip().lower()
    if db.scalar(select(User).where(func.lower(User.username) == username)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That username is already taken"
        )

    admin = User(
        username=username,
        email=payload.email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role="admin",
        is_active=True,
        last_login_at=utcnow(),
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return TokenResponse(
        access_token=create_access_token(admin),
        expires_in=settings.jwt_expire_minutes * 60,
        user=UserOut.model_validate(admin),
    )


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    username = payload.username.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.username) == username))

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password"
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise invalid
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been disabled. Contact your administrator.",
        )
    # The admin and user portals are separate doors; each only accepts its own role.
    if user.role != payload.role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "These credentials are not valid on this portal. "
                f"Use the {user.role} login page."
            ),
        )

    user.last_login_at = utcnow()
    db.commit()
    db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(user),
        expires_in=settings.jwt_expire_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/auth/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
        )
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    db.commit()
    return MessageResponse(detail="Password updated")
