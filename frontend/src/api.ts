import type {
  BootstrapStatus,
  DownloadLink,
  PasswordIssued,
  PortalFile,
  Role,
  TokenResponse,
  UploadResult,
  User,
} from "./types";

const TOKEN_KEY = "sftp.token";
export const MAX_SERVERLESS_UPLOAD_BYTES = 4 * 1024 * 1024;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);
  if (auth) {
    const token = tokenStore.get();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }
  if (rest.body && !(rest.body instanceof FormData)) {
    finalHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api${path}`, { ...rest, headers: finalHeaders });

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  const parsed = raw ? safeJson(raw) : null;

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(parsed) ?? raw ?? response.statusText);
  }
  return parsed as T;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** FastAPI reports errors as `detail`, which is a string or a validation-error array. */
function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" ? body : null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? ((item as { loc: unknown[] }).loc.slice(-1)[0] as string)
            : null;
          return loc ? `${loc}: ${(item as { msg: string }).msg}` : (item as { msg: string }).msg;
        }
        return String(item);
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return null;
}

export const api = {
  bootstrapStatus: () =>
    request<BootstrapStatus>("/bootstrap/status", { method: "GET", auth: false }),

  bootstrap: (body: {
    username: string;
    password: string;
    email?: string | null;
    full_name?: string | null;
    bootstrap_token?: string | null;
  }) =>
    request<TokenResponse>("/bootstrap", {
      method: "POST",
      auth: false,
      body: JSON.stringify(body),
    }),

  login: (username: string, password: string, role: Role) =>
    request<TokenResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ username, password, role }),
    }),

  me: () => request<User>("/auth/me", { method: "GET" }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ detail: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  listFiles: () => request<PortalFile[]>("/files", { method: "GET" }),

  downloadLink: (fileId: string) =>
    request<DownloadLink>(`/files/${fileId}/download-link`, { method: "POST" }),

  admin: {
    listUsers: () => request<User[]>("/admin/users", { method: "GET" }),

    createUser: (body: {
      username: string;
      email?: string | null;
      full_name?: string | null;
      password?: string | null;
    }) =>
      request<PasswordIssued>("/admin/users", { method: "POST", body: JSON.stringify(body) }),

    resetPassword: (userId: string, password?: string | null) =>
      request<PasswordIssued>(`/admin/users/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: password ?? null }),
      }),

    setActive: (userId: string, isActive: boolean) =>
      request<User>(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }),

    deleteUser: (userId: string) =>
      request<{ detail: string }>(`/admin/users/${userId}`, { method: "DELETE" }),

    listFiles: () => request<PortalFile[]>("/admin/files", { method: "GET" }),

    upload: (files: File[], notes: string, assignedUserIds: string[]) => {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      if (notes.trim()) form.append("notes", notes.trim());
      form.append("assigned_user_ids", JSON.stringify(assignedUserIds));
      return request<UploadResult>("/admin/files", { method: "POST", body: form });
    },

    deleteFile: (fileId: string) =>
      request<{ detail: string }>(`/admin/files/${fileId}`, { method: "DELETE" }),
  },
};

/** Opens a file using a short-lived, single-file download token. */
export async function downloadFile(fileId: string): Promise<void> {
  const link = await api.downloadLink(fileId);
  window.open(link.url, "_blank", "noopener");
}
