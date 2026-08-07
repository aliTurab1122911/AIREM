const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
  })
  if (!response.ok) {
    let details: unknown
    try { details = await response.json() } catch { details = undefined }
    throw new ApiError(`Request failed (${response.status})`, response.status, details)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export interface DashboardData {
  allowance: { used: number; total: number }
  metrics: Array<{ label: string; value: number | string; change?: string }>
  onboarding: Array<{ id: string; title: string; description: string; complete: boolean }>
  documents: Array<{ id: string; title: string; wordCount: number; updatedAt: string; status: string }>
  plan: { name: string; renewsAt?: string; price?: string }
}

export const api = {
  dashboard: () => request<DashboardData>('/api/dashboard'),
  login: (email: string, password: string) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  forgotPassword: (email: string) => request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
}

export { API_BASE_URL }
