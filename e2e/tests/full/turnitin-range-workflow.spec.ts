import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

function generateFixture() {
  const repoRoot = path.resolve(process.cwd(), "..");
  const generated = path.resolve(process.cwd(), "fixtures", "generated");
  mkdirSync(generated, { recursive: true });
  execFileSync("docker", ["compose", "exec", "-T", "processor", "python", "e2e/fixtures/generate_turnitin_fixture.py", "/tmp/turnitin-e2e"], { cwd: repoRoot, stdio: "inherit" });
  const source = path.join(generated, "source.docx");
  const report = path.join(generated, "turnitin.pdf");
  execFileSync("docker", ["compose", "cp", "processor:/tmp/turnitin-e2e/source.docx", source], { cwd: repoRoot, stdio: "inherit" });
  execFileSync("docker", ["compose", "cp", "processor:/tmp/turnitin-e2e/turnitin.pdf", report], { cwd: repoRoot, stdio: "inherit" });
  return { source, report };
}

async function register(page: import("@playwright/test").Page) {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name").fill("Turnitin Range E2E");
  await page.getByLabel("Email address").fill(`turnitin-${seed}@example.test`);
  await page.getByLabel("Password").fill("E2e-password-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test("verified Turnitin ranges can be expanded, reviewed, exported and continued into AIREM", async ({ page }) => {
  const fixture = generateFixture();
  await register(page);
  await page.goto("/app/rewrite", { waitUntil: "domcontentloaded" });

  await page.locator(".dropzone input[type=file]").setInputFiles(fixture.source);
  await page.getByRole("button", { name: "Upload and inspect" }).click();
  await expect(page.getByText("Word preview").first()).toBeVisible();

  await page.getByLabel("Turnitin AI-writing report").setInputFiles(fixture.report);
  await page.getByRole("button", { name: "Upload and verify report" }).click();
  await expect(page.getByTestId("turnitin-verification")).toContainText("Verified match");
  await expect(page.getByText("88%").first()).toBeVisible();

  await page.getByRole("button", { name: "Map exact highlights" }).click();
  await expect(page.getByText("Turnitin exact").first()).toBeVisible();
  await expect(page.getByText(/Turnitin cyan highlights mapped to exact DOCX/)).toBeVisible();

  await page.getByRole("button", { name: "Expand to paragraphs/tables" }).click();
  await expect(page.getByText("Turnitin expanded").first()).toBeVisible();
  await expect(page.getByText(/expanded to their full containing paragraphs/)).toBeVisible();

  await page.getByRole("button", { name: "Manual edit only" }).click();
  const reviews = page.getByTestId("range-review-cards");
  await expect(reviews).toBeVisible();
  const firstRevision = page.getByLabel("Approved revision 1");
  await firstRevision.fill("This paragraph was approved during selected-range review.");

  await page.getByRole("button", { name: "Reinsert and export DOCX" }).click();
  const ready = page.getByTestId("range-export-ready");
  await expect(ready).toBeVisible();
  const directLink = ready.getByRole("link", { name: "Download DOCX" });
  await expect(directLink).toHaveAttribute("href", /\/download\/.+_approved_range_edits_.+\.docx$/);
  const downloadPromise = page.waitForEvent("download");
  await directLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/source_approved_range_edits_.+\.docx/);

  await page.getByRole("button", { name: "Continue into AIREM" }).click();
  await expect(page.getByTestId("rewrite-workspace")).toBeVisible();
  await expect(page.getByLabel("Source text part 1")).toContainText("approved during selected-range review");

  // The continued source remains a normal AIREM extraction and can enter the
  // deterministic rewrite path without returning to the pre-review Turnitin text.
  await page.getByRole("button", { name: "Run initial rewrite" }).click();
  await expect(page.getByText(/Pass accepted|Safety fallback/).first()).toBeVisible();
});
