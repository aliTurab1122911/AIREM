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

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    credentials: "include",
  });
  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = undefined;
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
  rewriteDocument: (id: string, payload: Record<string, unknown>, cycle = false) =>
    request<Record<string, unknown>>(`/api/rewrite/${id}${cycle ? "/cycles" : ""}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  validateDocument: (id: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/validation/${id}`, { method: "POST", body: JSON.stringify(payload) }),
  reinsertDocument: (id: string, payload: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/reinsertion/${id}`, { method: "POST", body: JSON.stringify(payload) }),
  rewriteText: (payload: { text: string; profile?: string; intensity?: number }) =>
    request<Record<string, unknown>>("/api/text/rewrite", { method: "POST", body: JSON.stringify(payload) }),
  detectText: (text: string) =>
    request<Record<string, unknown>>("/api/detection/text", { method: "POST", body: JSON.stringify({ text }) }),
  detectFile: (file: File) => {
    const body = new FormData(); body.append("file", file);
    return request<Record<string, unknown>>("/api/detection/file", { method: "POST", body });
  },
  analyseFormatting: (file: File) => {
    const body = new FormData(); body.append("docx_file", file);
    return request<Record<string, unknown>>("/api/formatting/analyse", { method: "POST", body });
  },
  applyFormatting: (id: string, settings: Record<string, string | number | boolean>) =>
    request<Record<string, unknown>>(`/api/formatting/apply/${id}`, { method: "POST", body: JSON.stringify({ settings }) }),
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
    request("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
};

export { API_BASE_URL };
