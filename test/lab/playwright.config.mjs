import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  outputDir: "../../output/playwright/lab",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.LAB_BASE_URL || "http://127.0.0.1:4173/al-folio/",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: process.env.LAB_CHROMIUM_PATH ? { executablePath: process.env.LAB_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
