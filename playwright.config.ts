import { defineConfig } from "@playwright/test";

// BASE_URL=https://ridemapclip.vercel.app runs the suite against a deployment instead of a local build.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 240000,
  forbidOnly: !!process.env.CI,
  globalTimeout: process.env.CI ? 10 * 60_000 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "line",
  workers: 1,
  use: { channel: "chrome", headless: true, baseURL, viewport: { width: 1280, height: 1000 } },
  // Start Vite directly: through the pnpm wrapper the server can outlive the run on Linux and hang CI.
  webServer: process.env.BASE_URL ? undefined : { command: "node node_modules/vite/bin/vite.js preview --port 3100 --strictPort --host 127.0.0.1", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 60000 },
});
