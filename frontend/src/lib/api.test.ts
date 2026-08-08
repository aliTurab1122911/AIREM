import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, AUTH_REQUIRED_EVENT, canonicalArtifactUrls, request } from "./api";

const ok = () => Promise.resolve(new Response(null, { status: 204 })) as ReturnType<typeof fetch>;

describe("canonical artifact URL cutover", () => {
  it("rewrites processor download and preview links into the authenticated API namespace", () => {
    expect(canonicalArtifactUrls({
      download_url: "/download/11111111-1111-4111-8111-111111111111/4_org_fin/final.docx",
      nested: { preview_url: "/preview/11111111-1111-4111-8111-111111111111/turnitin/report.pdf", other: "unchanged" },
    })).toEqual({
      download_url: "/api/documents/download/11111111-1111-4111-8111-111111111111/4_org_fin/final.docx",
      nested: { preview_url: "/api/documents/preview/11111111-1111-4111-8111-111111111111/turnitin/report.pdf", other: "unchanged" },
    });
  });

  it("leaves canonical and unrelated URLs untouched", () => {
    expect(canonicalArtifactUrls(["/api/documents/download/job/file.docx", "https://example.test/report", null]))
      .toEqual(["/api/documents/download/job/file.docx", "https://example.test/report", null]);
  });
});

describe("CSRF request headers", () => {
  beforeEach(() => { document.cookie = "csrf=csrf-token-from-cookie"; vi.stubGlobal("fetch", vi.fn(ok)); });
  afterEach(() => { vi.unstubAllGlobals(); document.cookie = "csrf=; Max-Age=0"; });

  it.each([
    ["logout", () => api.logout()],
    ["profile edit", () => api.updateProfile("New name")],
    ["password change", () => api.changePassword("old password here", "new password here")],
    ["notification update", () => api.markNotificationRead("notification-id")],
    ["account deletion", () => api.deleteAccount()],
  ])("attaches the csrf cookie to %s", async (_name, action) => {
    await action();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-token-from-cookie");
  });

  it.each(["GET", "HEAD"])("does not attach CSRF to %s requests", async (method) => {
    await request("/api/account", { method });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it.each(["/api/auth/login","/api/auth/register","/api/auth/password-reset/request","/api/auth/password-reset/complete","/api/auth/verify"])
    ("does not attach CSRF to public endpoint %s", async (path) => {
      await request(path, { method: "POST", body: "{}" });
      const init = vi.mocked(fetch).mock.calls[0][1];
      expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
    });

  it.each([["missing", ""],["incorrect", "incorrect-token"]])("surfaces CSRF rejection for a %s token", async (_case, token) => {
    document.cookie = token ? `csrf=${token}` : "csrf=; Max-Age=0";
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: "CSRF_INVALID" } }), { status: 403, headers: { "Content-Type": "application/json" } }));
    await expect(api.logout()).rejects.toMatchObject({ status: 403, details: { error: { code: "CSRF_INVALID" } } });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe(token || null);
  });

  it("announces an expired session globally", async () => {
    const listener = vi.fn(); window.addEventListener(AUTH_REQUIRED_EVENT, listener);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED" } }), { status: 401, headers: { "Content-Type": "application/json" } }));
    await expect(request("/api/account/dashboard")).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce(); window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
  });
});
