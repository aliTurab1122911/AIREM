import { expect, test } from "@playwright/test";
import path from "node:path";

const fixture = path.resolve(process.cwd(), "../docs/sample_1_org.docx");

async function register(page: import("@playwright/test").Page) {
  const seed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Full name").fill("Secondary Studios E2E");
  await page.getByLabel("Email address").fill(`secondary-${seed}@example.test`);
  await page.getByLabel("Password").fill("E2e-password-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/app/rewrite", { waitUntil: "domcontentloaded" });
}

test("restores paste rewrite, detection, and formatting studios against the real stack", async ({ page }) => {
  await register(page);

  // Paste Text Rewriter — initial rewrite and an unlimited-style follow-up pass.
  await page.getByRole("tab", { name: "Paste text" }).click();
  const source = [
    "Furthermore, it is important to note that the project provides a comprehensive framework for evaluating technical decisions. The framework combines practical constraints, documented evidence, and a clear sequence of steps so that a reader can follow the reasoning without losing the original facts.",
    "Moreover, the findings suggest that careful review improves consistency across the final document. The same process is repeated for each section, but the wording should still sound natural, varied, and appropriate for a student explaining the work in their own voice.",
  ].join("\n\n");
  await page.getByLabel("Original pasted text").fill(source);
  await page.getByRole("button", { name: "Rewrite input" }).click();
  await expect(page.getByTestId("text-rewrite-result")).toBeVisible();
  const rewritten = page.getByLabel("Rewritten pasted text");
  await expect(rewritten).not.toHaveValue("");
  const firstPass = await rewritten.inputValue();
  await page.getByRole("button", { name: "Rewrite output again" }).click();
  await expect(page.getByTestId("text-rewrite-result")).toContainText("Pass 2");
  await expect(rewritten).not.toHaveValue("");
  expect((await rewritten.inputValue()).length).toBeGreaterThan(0);
  expect(firstPass.length).toBeGreaterThan(0);

  // Detection Studio — pasted text includes deterministic passage candidates, then a real DOCX upload.
  await page.getByRole("tab", { name: "Detection" }).click();
  await page.getByLabel("Detection text").fill(source);
  await page.getByRole("button", { name: "Analyse text" }).click();
  await expect(page.getByTestId("detection-report")).toBeVisible();
  await expect(page.getByTestId("risk-passages")).toBeVisible();
  await expect(page.getByTestId("risk-passages").locator("article")).toHaveCount(2);

  await page.getByRole("button", { name: "Upload file" }).click();
  await page.getByLabel("Detection file").setInputFiles(fixture);
  await page.getByRole("button", { name: "Analyse file" }).click();
  await expect(page.getByTestId("detection-report")).toBeVisible();
  await expect(page.getByText("File · sample_1_org.docx")).toBeVisible();

  // Formatting Studio — analyse the real DOCX, change live controls, apply JSON settings, download result.
  await page.getByRole("tab", { name: "Formatting" }).click();
  await page.getByLabel("Formatting DOCX").setInputFiles(fixture);
  await page.getByRole("button", { name: "Analyse formatting" }).click();
  const preview = page.getByTestId("format-live-preview");
  await expect(preview).toBeVisible();

  await page.getByLabel("Body size").fill("12.5");
  await page.getByLabel("Orientation").selectOption("landscape");
  await page.getByLabel("Header text").fill("AIREM secondary studio E2E");
  await page.getByText("Add page border", { exact: true }).click();
  await page.getByText("Add Table of Contents", { exact: true }).click();
  await expect(preview).toContainText("AIREM secondary studio E2E");
  await expect(preview).toContainText("Table of Contents");

  await page.getByRole("button", { name: "Apply configuration" }).click();
  await expect(page.getByTestId("formatting-result")).toBeVisible();
  const exportLink = page.getByRole("link", { name: "Export formatted DOCX" });
  await expect(exportLink).toHaveAttribute("href", /\/download\/[0-9a-f-]+\/formatted\/sample_1_org_formatted\.docx$/);

  const downloadPromise = page.waitForEvent("download");
  await exportLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sample_1_org_formatted.docx");
});
