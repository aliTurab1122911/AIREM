import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/full",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  outputDir: "test-results/full",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://127.0.0.1:8443",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "authenticated-desktop", use: { ...devices["Desktop Chrome"] } }],
});
