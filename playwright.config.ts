import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 240000,
  workers: 1,
  use: { channel: "msedge", headless: true, baseURL: "http://127.0.0.1:3100", viewport: { width: 1280, height: 1000 } },
  webServer: { command: "node node_modules/next/dist/bin/next start --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 60000 },
});
