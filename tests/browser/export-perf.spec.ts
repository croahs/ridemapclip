import { test, expect } from "@playwright/test";
import { rideFit, stubTiles } from "./fixtures";

// Opt-in benchmark: PERF=1 pnpm test:browser export-perf
test.skip(!process.env.PERF, "set PERF=1 to measure export time");

for (const [riders, seconds, clipSeconds] of [[2, 3600, 30], [200, 3600, 30], [200, 3600, 120]] as const) {
  test(`export time for ${riders} one-hour rides in a ${clipSeconds}-second clip`, async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await stubTiles(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(Array.from({ length: riders }, (_, i) => rideFit(`ride-${i + 1}.fit`, i, seconds)));
    await page.getByRole("button", { name: `Create ${riders} tracks`, exact: true }).click();
    const length = page.getByLabel("Clip length in seconds", { exact: true });
    await length.fill(String(clipSeconds));
    await length.press("Enter");
    const create = page.getByRole("button", { name: "Create video", exact: true });
    await expect(create).toBeVisible({ timeout: 120_000 });
    await page.locator(".leaflet-tile-loaded").first().waitFor();
    const started = Date.now();
    await create.click();
    await expect(page.getByText("Your video is ready.")).toBeVisible({ timeout: 19 * 60_000 });
    const bytes = await page.locator("video").evaluate(async element => (await (await fetch((element as HTMLVideoElement).src)).blob()).size);
    console.log(`PERF export ${riders} riders × ${seconds} points, ${clipSeconds} s clip: ${((Date.now() - started) / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(0)} MB`);
  });
}
