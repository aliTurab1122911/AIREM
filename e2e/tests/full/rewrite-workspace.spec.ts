import { expect, test } from "@playwright/test";
import path from "node:path";

async function registerIsolatedUser(page: import("@playwright/test").Page) {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name").fill("Rewrite Workspace E2E");
  await page.getByLabel("Email address").fill(`rewrite-${seed}@example.test`);
  await page.getByLabel("Password").fill("E2e-password-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("upload -> select -> rewrite -> cycle -> edit -> validate -> reinsert -> download", async ({ page }) => {
  await registerIsolatedUser(page);
  await page.goto("/app/rewrite", { waitUntil: "domcontentloaded" });

  const fixture = path.resolve(process.cwd(), "../docs/sample_1_org.docx");
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload and inspect" }).click();

  await expect(page.getByText("Word preview", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create immutable extraction" }).click();

  await expect(page.getByTestId("rewrite-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/chunk\(s\) remain keyed to the extraction map/)).toBeVisible();

  await page.getByRole("button", { name: "Run initial rewrite" }).click();
  await expect(page.getByText(/Pass 1 · cycle 0/)).toBeVisible({ timeout: 120_000 });

  const cycleButton = page.getByRole("button", { name: "Run another cycle" });
  await expect(cycleButton).toBeEnabled();
  await cycleButton.click();
  await expect(page.getByText(/cycle 1/).first()).toBeVisible({ timeout: 120_000 });

  const current = page.getByTestId("current-chunk-1");
  const before = await current.inputValue();
  const edited = before.replace(/[A-Za-z]/, character => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase());
  expect(edited).not.toBe(before);
  await current.fill(edited);

  await page.getByRole("button", { name: "Validate current text" }).click();
  await expect(page.getByTestId("validation-result")).toContainText("Validation passed", { timeout: 60_000 });

  await page.getByRole("button", { name: "Reinsert into DOCX" }).click();
  const ready = page.getByTestId("download-ready");
  await expect(ready).toContainText("Final DOCX is ready", { timeout: 60_000 });

  const downloadLink = ready.getByRole("link", { name: "Download final DOCX" });
  await expect(downloadLink).toHaveAttribute("href", /\/download\/[^/]+\/4_org_fin\/4_org_fin\.docx$/);
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("4_org_fin.docx");
});
