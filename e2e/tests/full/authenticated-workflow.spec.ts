import { expect, test } from "@playwright/test";

test("registers an isolated account and completes an authenticated session", async ({
  page,
}) => {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `e2e-${seed}@example.test`;
  const password = "E2e-password-2026!";

  // Registration seeds this run's account, allowance, and subscription through
  // the production services instead of installing browser request mocks.
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name").fill("E2E Isolated User");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("1,000").first()).toBeVisible();
});
