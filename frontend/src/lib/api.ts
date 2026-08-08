import {
  documentJobResponseSchema,
  documentUploadResponseSchema,
  extractionResponseSchema,
  rewriteResponseSchema,
  validationResponseSchema,
  reinsertionResponseSchema,
  textRewriteResponseSchema,
  detectionResponseSchema,
  detectionFileResponseSchema,
  formattingAnalysisResponseSchema,
  formattingApplyResponseSchema,
  turnitinUploadResponseSchema,
  rangeEditConfigurationResponseSchema,
  rangeEditDraftResponseSchema,
  rangeEditExportResponseSchema,
  rangeEditContinueResponseSchema,
  type RangeSelectionRequest,
  type RewriteRequest,
  type RewriteCycleRequest,
  type ValidationRequest,
  type ReinsertionRequest,
  type TextRewriteRequest,
  type FormattingApplyRequest,
  type RangeEditDraftRequest,
  type RangeEditActionRequest,
  type DocumentUploadResponse,
  type DocumentJobResponse,
  type ExtractionResponse,
  type RewriteResponse,
  type ValidationResponse,
  type ReinsertionResponse,
  type TextRewriteResponse,
  type DetectionResponse,
  type DetectionFileResponse,
  type FormattingAnalysisResponse,
  type FormattingApplyResponse,
  type TurnitinUploadResponse,
  type RangeEditConfigurationResponse,
  type RangeEditDraftResponse,
  type RangeEditExportResponse,
  type RangeEditContinueResponse,
} from "@airem/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
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

type RuntimeSchema<T> = { parse(value: unknown): T };

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

/**
 * Processor internals still create artifact links using their historical Flask
 * route names. Production clients never expose those routes: normalize every
 * processor-provided artifact URL to the authenticated gateway namespace at the
 * single React API boundary.
 */
function canonicalArtifactUrls(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("/download/")) return `/api/documents/download/${value.slice("/download/".length)}`;
    if (value.startsWith("/preview/")) return `/api/documents/preview/${value.slice("/preview/".length)}`;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalArtifactUrls);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, canonicalArtifactUrls(item)]));
  }
  return value;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  schema?: RuntimeSchema<T>,
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(
    options.body instanceof FormData
      ? options.headers
      : { "Content-Type": "application/json", ...options.headers },
  );
  const csrf = cookie("csrf");
  if (csrf && shouldAttachCsrf(url, path, method)) headers.set("x-csrf-token", csrf);

  const response = await fetch(url, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    let details: unknown;
    try { details = await response.json(); } catch { details = undefined; }
    if (
      response.status === 401 &&
      (details as { error?: { code?: string } } | undefined)?.error?.code === "AUTH_REQUIRED" &&
      typeof window !== "undefined"
    ) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    const processorMessage = (details as { error?: { message?: string }; message?: string } | undefined)?.error?.message
      ?? (details as { message?: string } | undefined)?.message;
    throw new ApiError(processorMessage || `Request failed (${response.status})`, response.status, details);
  }
  if (response.status === 204) return undefined as T;
  const raw: unknown = await response.json();
  const value = canonicalArtifactUrls(raw);
  return schema ? schema.parse(value) : value as T;
}

export interface DashboardData {
  allowance: { used: number; total: number };
  metrics: Array<{ label: string; value: number | string; change?: string }>;
  onboarding: Array<{ id: string; title: string; description: string; complete: boolean }>;
  documents: Array<{ id: string; title: string; wordCount: number; updatedAt: string; status: string }>;
  plan: { name: string; renewsAt?: string; price?: string };
}
export type JobState = "queued" | "processing" | "review_required" | "completed" | "failed" | "expired";
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
  uploadDocument: (file: File): Promise<DocumentUploadResponse> => {
    const body = new FormData();
    body.append("docx_file", file);
    return request("/api/documents/upload", { method: "POST", body }, documentUploadResponseSchema);
  },
  documentJob: (id: string): Promise<DocumentJobResponse> => request(`/api/documents/jobs/${id}`, {}, documentJobResponseSchema),
  extractRanges: (id: string, payload: RangeSelectionRequest): Promise<ExtractionResponse> => request(`/api/ranges/${id}/extract`, { method: "POST", body: JSON.stringify(payload) }, extractionResponseSchema),
  uploadTurnitin: (id: string, file: File): Promise<TurnitinUploadResponse> => { const body = new FormData(); body.append("turnitin_pdf", file); return request(`/api/turnitin/${id}`, { method: "POST", body }, turnitinUploadResponseSchema); },
  rangeEditConfiguration: (): Promise<RangeEditConfigurationResponse> => request("/api/ranges/configuration", {}, rangeEditConfigurationResponseSchema),
  draftRangeEdits: (id: string, payload: RangeEditDraftRequest): Promise<RangeEditDraftResponse> => request(`/api/ranges/${id}/draft`, { method: "POST", body: JSON.stringify(payload) }, rangeEditDraftResponseSchema),
  exportRangeEdits: (id: string, payload: RangeEditActionRequest): Promise<RangeEditExportResponse> => request(`/api/ranges/${id}/export`, { method: "POST", body: JSON.stringify(payload) }, rangeEditExportResponseSchema),
  continueRangeEdits: (id: string, payload: RangeEditActionRequest): Promise<RangeEditContinueResponse> => request(`/api/ranges/${id}/continue`, { method: "POST", body: JSON.stringify(payload) }, rangeEditContinueResponseSchema),
  rewriteProfiles: () => request<Record<string, unknown>>("/api/rewrite/profiles"),
  rewriteDocument: (id: string, payload: RewriteRequest): Promise<RewriteResponse> => request(`/api/rewrite/${id}`, { method: "POST", body: JSON.stringify(payload) }, rewriteResponseSchema),
  rewriteDocumentCycle: (id: string, payload: RewriteCycleRequest): Promise<RewriteResponse> => request(`/api/rewrite/${id}/cycles`, { method: "POST", body: JSON.stringify(payload) }, rewriteResponseSchema),
  validateDocument: (id: string, payload: ValidationRequest): Promise<ValidationResponse> => request(`/api/validation/${id}`, { method: "POST", body: JSON.stringify(payload) }, validationResponseSchema),
  reinsertDocument: (id: string, payload: ReinsertionRequest): Promise<ReinsertionResponse> => request(`/api/reinsertion/${id}`, { method: "POST", body: JSON.stringify(payload) }, reinsertionResponseSchema),
  rewriteText: (payload: TextRewriteRequest): Promise<TextRewriteResponse> => request("/api/text/rewrite", { method: "POST", body: JSON.stringify(payload) }, textRewriteResponseSchema),
  detectText: (text: string): Promise<DetectionResponse> => request("/api/detection/text", { method: "POST", body: JSON.stringify({ text }) }, detectionResponseSchema),
  detectFile: (file: File): Promise<DetectionFileResponse> => { const body = new FormData(); body.append("file", file); return request("/api/detection/file", { method: "POST", body }, detectionFileResponseSchema); },
  analyseFormatting: (file: File): Promise<FormattingAnalysisResponse> => { const body = new FormData(); body.append("docx_file", file); return request("/api/formatting/analyse", { method: "POST", body }, formattingAnalysisResponseSchema); },
  applyFormatting: (id: string, settings: FormattingApplyRequest["settings"]): Promise<FormattingApplyResponse> => request(`/api/formatting/apply/${id}`, { method: "POST", body: JSON.stringify({ settings } satisfies FormattingApplyRequest) }, formattingApplyResponseSchema),
  downloadUrl: (id: string, filename: string) => `${API_BASE_URL}/api/documents/download/${id}/${encodeURIComponent(filename)}`,
  accountDashboard: () => request<import("../features/dashboard/types").AccountDashboard>("/api/account/dashboard"),
  usageHistory: () => request<import("../features/dashboard/types").AccountDashboard["usageHistory"]>("/api/account/usage-history"),
  notifications: () => request<import("../features/dashboard/types").AccountDashboard["notifications"]>("/api/account/notifications"),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  jobs: () => request<{ jobs: ProcessingJob[] }>("/api/jobs"),
  cancelJob: (id: string) => request(`/api/jobs/${id}`, { method: "DELETE" }),
  login: (email: string, password: string) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (displayName: string, email: string, password: string) => request("/api/auth/register", { method: "POST", body: JSON.stringify({ displayName, email, password }) }),
  forgotPassword: (email: string) => request("/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email }) }),
  verifyEmail: (token: string) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  completePasswordReset: (token: string, password: string) => request("/api/auth/password-reset/complete", { method: "POST", body: JSON.stringify({ token, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  updateProfile: (displayName: string | null) => request("/api/account", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  changePassword: (currentPassword: string, newPassword: string) => request("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  markNotificationRead: (id: string) => request(`/api/account/notifications/${id}/read`, { method: "PATCH" }),
  deleteAccount: () => request("/api/account", { method: "DELETE" }),
};

export { API_BASE_URL, canonicalArtifactUrls };
