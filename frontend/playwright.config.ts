import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:8177",
    locale: "en-GB",
  },
  webServer: {
    command: "bash e2e/serve.sh",
    url: "http://localhost:8177/healthz",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
