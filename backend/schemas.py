from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class BootstrapStatus(BaseModel):
    needs_bootstrap: bool
    requires_token: bool
    storage_backend: str
    max_upload_mb: int
    # True when the browser should upload straight to Vercel Blob (see
    # /admin/files/client-token) instead of posting the bytes to this API.
    direct_upload: bool


class BootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)
    bootstrap_token: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str
    role: Literal["admin", "user"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    email: str | None = None
    full_name: str | None = None
    role: str
    is_active: bool
    must_change_password: bool
    created_at: datetime
    last_login_at: datetime | None = None
    # Only populated on the login response: the sign-in *before* this one, so the
    # dashboard can greet with "User last login time is ...".
    previous_login_at: datetime | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)
    # Left blank, the server generates one and returns it once.
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UpdateUserRequest(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)


class PasswordIssued(BaseModel):
    user: UserOut
    password: str
    generated: bool


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class FileOut(BaseModel):
    id: str
    original_name: str
    content_type: str
    size_bytes: int
    notes: str | None = None
    created_at: datetime
    uploaded_by: str | None = None
    shared_with_everyone: bool = True
    assigned_user_ids: list[str] = Field(default_factory=list)
    # Retention: every file is deleted this many seconds from now.
    expires_at: datetime
    seconds_remaining: int
    is_pdf: bool = False
    # Whether the caller has already collected this file (user view).
    downloaded_by_me: bool = False
    # How many recipients have collected it (admin view).
    download_count: int = 0


class CleanupResult(BaseModel):
    deleted: int
    files: list[str] = Field(default_factory=list)
    retention_days: int


class UploadResult(BaseModel):
    uploaded: list[FileOut]
    failed: list[dict]


class ClientTokenPayload(BaseModel):
    pathname: str
    clientPayload: str | None = None
    multipart: bool = False


class ClientTokenRequest(BaseModel):
    """The event @vercel/blob/client's upload() posts to its handleUploadUrl."""

    type: Literal["blob.generate-client-token"]
    payload: ClientTokenPayload


class ClientTokenResponse(BaseModel):
    type: Literal["blob.generate-client-token"] = "blob.generate-client-token"
    clientToken: str


class RegisterUploadRequest(BaseModel):
    """Sent once the browser has finished a direct-to-Blob upload."""

    url: str = Field(max_length=2048)
    original_name: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)
    # Empty list shares the file with everyone.
    assigned_user_ids: list[str] = Field(default_factory=list)


class DownloadLink(BaseModel):
    url: str
    expires_in: int


class MessageResponse(BaseModel):
    detail: str
