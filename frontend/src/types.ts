export type Role = "admin" | "user";

export interface User {
  id: string;
  username: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  /** Only present on the login response: the sign-in before this one. */
  previous_login_at?: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface BootstrapStatus {
  needs_bootstrap: boolean;
  requires_token: boolean;
  storage_backend: string;
  max_upload_mb: number;
  /** Upload straight to Vercel Blob instead of through the API function. */
  direct_upload: boolean;
}

export interface PortalFile {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  notes: string | null;
  created_at: string;
  uploaded_by: string | null;
  shared_with_everyone: boolean;
  assigned_user_ids: string[];
  expires_at: string;
  seconds_remaining: number;
  is_pdf: boolean;
  downloaded_by_me: boolean;
  download_count: number;
}

export interface UploadResult {
  uploaded: PortalFile[];
  failed: { name: string; error: string }[];
}

export interface PasswordIssued {
  user: User;
  password: string;
  generated: boolean;
}

export interface DownloadLink {
  url: string;
  expires_in: number;
}
