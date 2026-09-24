import { test, expect } from "@playwright/test";
import { rideFit, stubTiles } from "./fixtures";

// Opt-in benchmark: PERF=1 pnpm test:browser export-perf
test.skip(!process.env.PERF, "set PERF=1 to measure export time");

const cases = [[2, 3600, 30], [200, 3600, 30], [200, 3600, 120], [1000, 3600, 30]] as const;

for (const [riders, seconds, clipSeconds] of cases) {
  test(`export time for ${riders} one-hour rides in a ${clipSeconds}-second clip`, async ({ page }) => {
    test.setTimeout(30 * 60_000);
    await stubTiles(page);
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(Array.from({ length: riders }, (_, i) => rideFit(`ride-${i + 1}.fit`, i, seconds)));
    const parseStarted = Date.now();
    await page.getByRole("button", { name: `Create ${riders} tracks`, exact: true }).click();
    const length = page.getByLabel("Clip length in seconds", { exact: true });
    await length.waitFor({ timeout: 10 * 60_000 });
    const parseSeconds = (Date.now() - parseStarted) / 1000;
    await length.fill(String(clipSeconds));
    await length.press("Enter");
    const heapMb = await page.evaluate(() => Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1e6));
    // Preview smoothness: count animation frames over three seconds of playback.
    await page.getByRole("button", { name: "Play animation", exact: true }).click();
    const fps = await page.evaluate(() => new Promise<number>(resolve => {
      let frames = 0;
      const start = performance.now();
      const count = (now: number) => { frames++; if (now - start < 3000) requestAnimationFrame(count); else resolve(frames / ((now - start) / 1000)); };
      requestAnimationFrame(count);
    }));
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const create = page.getByRole("button", { name: "Create video", exact: true });
    await page.locator(".leaflet-tile-loaded").first().waitFor();
    const started = Date.now();
    await create.click();
    await expect(page.getByText("Your video is ready.")).toBeVisible({ timeout: 25 * 60_000 });
    const bytes = await page.locator("video").evaluate(async element => (await (await fetch((element as HTMLVideoElement).src)).blob()).size);
    console.log(`PERF ${riders} riders × ${seconds} points, ${clipSeconds} s clip: parse ${parseSeconds.toFixed(1)} s, heap ${heapMb} MB, preview ${fps.toFixed(0)} fps, export ${((Date.now() - started) / 1000).toFixed(1)} s, ${(bytes / 1e6).toFixed(0)} MB`);
  });
}
