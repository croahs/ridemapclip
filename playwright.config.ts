import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 240000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: { channel: "chrome", headless: true, baseURL: "http://127.0.0.1:3100", viewport: { width: 1280, height: 1000 } },
  webServer: { command: "pnpm preview --port 3100 --strictPort --host 127.0.0.1", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 60000 },
});
