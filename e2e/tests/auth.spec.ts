import { expect, test } from "@playwright/test";

const dashboard = {
  usage: {
    wordsProcessed: 0,
    remainingWords: 1000,
    wordAllowance: 1000,
    periodStart: "2026-08-01",
    periodEnd: "2026-09-01",
  },
  documents: {
    total: 0,
    byStatus: { draft: 0, processing: 0, review: 0, complete: 0, failed: 0 },
  },
  protectedDetails: { total: 0 },
  reviewWarnings: { total: 0 },
  recentDocuments: { documents: [] },
  notifications: { notifications: [], unreadCount: 0 },
  usageHistory: { months: [] },
  subscription: {
    planCode: "free",
    billingEnabled: false,
    wordAllowance: 1000,
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/account/dashboard", (route) =>
    route.fulfill({ json: dashboard }),
  );
});

test("registration, login, and logout", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/auth/**", async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      json: { user: { email: "alex@example.test" } },
    });
  });
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Alex Morgan");
  await page.getByLabel("Email address").fill("alex@example.test");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("alex@example.test");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("button", { name: "Log out" }).click();
  expect(requests).toEqual(
    expect.arrayContaining(["/api/auth/register", "/api/auth/login"]),
  );
});

test("forgot-password uses the public proxy path without revealing accounts", async ({
  page,
}) => {
  const submissions: Array<{ path: string; email: string }> = [];
  await page.route("**/api/auth/password-reset/request", async (route) => {
    submissions.push({
      path: new URL(route.request().url()).pathname,
      email: route.request().postDataJSON().email,
    });
    await route.fulfill({ status: 200, json: { ok: true } });
  });

  for (const email of ["alex@example.test", "unknown@example.test"]) {
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText(
      "If an account exists",
    );
  }

  expect(submissions).toEqual([
    {
      path: "/api/auth/password-reset/request",
      email: "alex@example.test",
    },
    {
      path: "/api/auth/password-reset/request",
      email: "unknown@example.test",
    },
  ]);
});

test("expired sessions are returned to login", async ({ page }) => {
  await page.route("**/api/account/dashboard", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "AUTH_REQUIRED" } } }),
  );
  await page.goto("/app");
  await expect(page.getByRole("alert")).toBeVisible();
});
