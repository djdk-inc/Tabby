import { defineConfig } from "@playwright/test";
export default defineConfig({
  timeout: 45_000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "work/playwright-results.json" }]],
  use: { trace: "retain-on-failure" }
});
