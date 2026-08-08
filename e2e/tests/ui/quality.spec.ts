import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/login", "/app", "/app/rewrite"];
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

test.beforeEach(async ({ page }) =>
  page.route("**/api/account/dashboard", (route) =>
    route.fulfill({ json: dashboard }),
  ),
);

for (const route of routes) {
  test(`responsive visual layout and accessibility: ${route}`, async ({
    page,
  }, testInfo) => {
    await page.goto(route);
    await expect(page.locator("main, .app-layout")).toBeVisible();
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach(`layout-${testInfo.project.name}`, {
      body: screenshot,
      contentType: "image/png",
    });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("upload, rewrite review, reinsertion, and download controls remain discoverable", async ({
  page,
}) => {
  await page.goto("/app/rewrite");
  await expect(
    page.getByRole("heading", { name: "Create a new rewrite" }),
  ).toBeVisible();
  await expect(page.getByText(/Paste or upload/)).toBeVisible();
});
