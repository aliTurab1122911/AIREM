const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const AUTH_REQUIRED_EVENT = "airem:auth-required";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/complete",
  "/api/auth/verify",
]);

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  return value === undefined ? undefined : decodeURIComponent(value);
}

function shouldAttachCsrf(url: string, path: string, method: string): boolean {
  if (SAFE_METHODS.has(method) || CSRF_EXEMPT_PATHS.has(path)) return false;
  if (typeof window === "undefined") return false;
  return new URL(url, window.location.href).origin === window.location.origin;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(
    options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers },
  );
  const csrf = cookie("csrf");
  if (csrf && shouldAttachCsrf(url, path, method)) {
    headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = undefined;
    }
    if (
      response.status === 401 &&
      (details as { error?: { code?: string } } | undefined)?.error?.code ===
        "AUTH_REQUIRED" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    throw new ApiError(
      `Request failed (${response.status})`,
      response.status,
      details,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface DashboardData {
  allowance: { used: number; total: number };
  metrics: Array<{ label: string; value: number | string; change?: string }>;
  onboarding: Array<{
    id: string;
    title: string;
    description: string;
    complete: boolean;
  }>;
  documents: Array<{
    id: string;
    title: string;
    wordCount: number;
    updatedAt: string;
    status: string;
  }>;
  plan: { name: string; renewsAt?: string; price?: string };
}
export type JobState =
  | "queued"
  | "processing"
  | "review_required"
  | "completed"
  | "failed"
  | "expired";
export interface ProcessingJob {
  id: string;
  operation: string;
  state: JobState;
  progress: number;
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  session: () => request<{ user: AuthUser }>("/api/auth/session"),
  uploadDocument: (file: File) => {
    const body = new FormData();
    body.append("docx_file", file);
    return request<Record<string, unknown>>("/api/documents/upload", {
      method: "POST",
      body,
    });
  },
  documentJob: (id: string) =>
    request<Record<string, unknown>>(`/api/documents/jobs/${id}`),
  extractRanges: (id: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/ranges/${id}/extract`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rewriteProfiles: () =>
    request<Record<string, unknown>>("/api/rewrite/profiles"),
  rewriteDocument: (
    id: string,
    payload: Record<string, unknown>,
    cycle = false,
  ) =>
    request<Record<string, unknown>>(
      `/api/rewrite/${id}${cycle ? "/cycles" : ""}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  validateDocument: (id: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/validation/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  reinsertDocument: (id: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/reinsertion/${id}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  rewriteText: (payload: {
    text: string;
    profile?: string;
    intensity?: number;
  }) =>
    request<Record<string, unknown>>("/api/text/rewrite", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  detectText: (text: string) =>
    request<Record<string, unknown>>("/api/detection/text", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  detectFile: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Record<string, unknown>>("/api/detection/file", {
      method: "POST",
      body,
    });
  },
  analyseFormatting: (file: File) => {
    const body = new FormData();
    body.append("docx_file", file);
    return request<Record<string, unknown>>("/api/formatting/analyse", {
      method: "POST",
      body,
    });
  },
  applyFormatting: (
    id: string,
    settings: Record<string, string | number | boolean>,
  ) =>
    request<Record<string, unknown>>(`/api/formatting/apply/${id}`, {
      method: "POST",
      body: JSON.stringify({ settings }),
    }),
  downloadUrl: (id: string, filename: string) =>
    `${API_BASE_URL}/api/documents/download/${id}/${encodeURIComponent(filename)}`,
  accountDashboard: () =>
    request<import("../features/dashboard/types").AccountDashboard>(
      "/api/account/dashboard",
    ),
  usageHistory: () =>
    request<
      import("../features/dashboard/types").AccountDashboard["usageHistory"]
    >("/api/account/usage-history"),
  notifications: () =>
    request<
      import("../features/dashboard/types").AccountDashboard["notifications"]
    >("/api/account/notifications"),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  jobs: () => request<{ jobs: ProcessingJob[] }>("/api/jobs"),
  cancelJob: (id: string) => request(`/api/jobs/${id}`, { method: "DELETE" }),
  login: (email: string, password: string) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (name: string, email: string, password: string) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  forgotPassword: (email: string) =>
    request("/api/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyEmail: (token: string) =>
    request("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  completePasswordReset: (token: string, password: string) =>
    request("/api/auth/password-reset/complete", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  updateProfile: (displayName: string | null) =>
    request("/api/account", {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/account/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  markNotificationRead: (id: string) =>
    request(`/api/account/notifications/${id}/read`, { method: "PATCH" }),
  deleteAccount: () => request("/api/account", { method: "DELETE" }),
};

export { API_BASE_URL };
