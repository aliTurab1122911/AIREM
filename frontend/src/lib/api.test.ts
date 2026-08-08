import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, request } from "./api";

const ok = () =>
  Promise.resolve(new Response(null, { status: 204 })) as ReturnType<
    typeof fetch
  >;

describe("CSRF request headers", () => {
  beforeEach(() => {
    document.cookie = "csrf=csrf-token-from-cookie";
    vi.stubGlobal("fetch", vi.fn(ok));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "csrf=; Max-Age=0";
  });

  it.each([
    ["logout", () => api.logout()],
    ["profile edit", () => api.updateProfile("New name")],
    ["password change", () => api.changePassword("old password here", "new password here")],
    ["notification update", () => api.markNotificationRead("notification-id")],
    ["account deletion", () => api.deleteAccount()],
  ])("attaches the csrf cookie to %s", async (_name, action) => {
    await action();
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe(
      "csrf-token-from-cookie",
    );
  });

  it.each(["GET", "HEAD"])("does not attach CSRF to %s requests", async (method) => {
    await request("/api/account", { method });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it.each([
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/password-reset/request",
    "/api/auth/password-reset/complete",
    "/api/auth/verify",
  ])("does not attach CSRF to public endpoint %s", async (path) => {
    await request(path, { method: "POST", body: "{}" });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).has("x-csrf-token")).toBe(false);
  });

  it.each([
    ["missing", ""],
    ["incorrect", "incorrect-token"],
  ])("surfaces CSRF rejection for a %s token", async (_case, token) => {
    document.cookie = token
      ? `csrf=${token}`
      : "csrf=; Max-Age=0";
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "CSRF_INVALID" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(api.logout()).rejects.toMatchObject({
      status: 403,
      details: { error: { code: "CSRF_INVALID" } },
    });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe(token || null);
  });
});
