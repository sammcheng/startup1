import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: "node tests/mock-api.mjs",
          url: "http://127.0.0.1:8009/health",
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
        {
          command: "NEXT_PUBLIC_API_URL=http://127.0.0.1:8009/v1 npm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
