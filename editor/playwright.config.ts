import { defineConfig, devices } from "@playwright/test";

// Specs navigate relative to baseURL, so the suite runs on any free port:
// PLAYWRIGHT_PORT=4181 npm run test:e2e
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../.codex/runtime/playwright-results",
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "../.codex/runtime/playwright-report", open: "never" }]] : "line",
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
