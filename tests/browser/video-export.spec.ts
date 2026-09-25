import { test, expect } from "@playwright/test";
import { rideFit, stubTiles } from "./fixtures";

test("creates, plays and downloads a 30-second MP4 after cancellation and map positioning", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([rideFit("first.fit", 0, 600), rideFit("second.fit", 3, 900)]);
  await page.getByRole("button", {name: "Create 2 tracks", exact: true}).click();
  const create = page.getByRole("button", {name: "Create video", exact: true});
  await expect(create).toBeVisible({timeout: 30000});
  await page.locator(".leaflet-tile-loaded").first().waitFor();
  const map = page.getByRole("region", {name: "Interactive map of 2 tracks"});
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 20, {steps: 8}); await page.mouse.up();
  await page.screenshot({path: testInfo.outputPath("map-before.png"), fullPage: true});
  await create.click();
  // Cancel once rendering is under way; slower CI machines take longer to get there.
  await expect.poll(() => page.getByRole("progressbar", {name: "Video rendering progress"}).getAttribute("value"), {timeout: 60000}).toMatch(/^0\.0*[1-9]/);
  await page.getByRole("button", {name: "Cancel rendering"}).click();
  await expect(create).toBeEnabled({timeout: 30000});
  await create.click();
  await expect(page.getByText("Your video is ready.")).toBeVisible({timeout: 180000});
  const video = page.locator("video");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThan(0);
  const metadata = await video.evaluate(element => {
    const v = element as HTMLVideoElement;
    return {duration: v.duration, width: v.videoWidth, height: v.videoHeight};
  });
  expect(metadata).toEqual({duration: 30, width: 1920, height: 1080});
  await video.evaluate(async element => { const v = element as HTMLVideoElement; v.muted = true; await v.play(); });
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);
  await video.evaluate(element => { (element as HTMLVideoElement).pause(); });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", {name: "Download MP4"}).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("ridemapclip.mp4");
  await download.saveAs(testInfo.outputPath("ridemapclip.mp4"));
  await page.screenshot({path: testInfo.outputPath("video-ready.png"), fullPage: true});
  expect(errors).toEqual([]);
});

test("renders a large group without dropping output frames", async ({page}, testInfo) => {
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(Array.from({length: 25}, (_, index) => rideFit(`rider-${index + 1}.fit`, index)));
  await page.getByRole("button", {name: "Create 25 tracks", exact: true}).click();
  const create = page.getByRole("button", {name: "Create video", exact: true});
  await expect(create).toBeVisible({timeout: 30000});
  await create.click();
  await expect(page.getByText("Your video is ready.")).toBeVisible({timeout: 180000});
  await expect.poll(() => page.locator("video").evaluate(element => (element as HTMLVideoElement).duration)).toBe(30);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", {name: "Download MP4"}).click();
  await (await downloaded).saveAs(testInfo.outputPath("large-group.mp4"));
});

test("the chosen clip length drives preview and video", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([rideFit("first.fit", 0, 600), rideFit("second.fit", 3, 900)]);
  await page.getByRole("button", { name: "Create 2 tracks", exact: true }).click();
  const length = page.getByLabel("Clip length in seconds", { exact: true });
  await length.fill("9");
  await length.press("Enter");
  await expect(length).toHaveValue("15");
  await expect(page.getByLabel("Playback time")).toHaveText("0:00 / 0:15");
  await expect(page.getByText(/Finishes at 15s in the clip/)).toHaveCount(1);
  await expect(page.getByText(/Finishes at 10s in the clip/)).toHaveCount(1);
  await page.getByRole("button", { name: "Create video", exact: true }).click();
  await expect(page.getByText("Your video is ready.")).toBeVisible({ timeout: 180000 });
  await expect.poll(() => page.locator("video").evaluate(element => (element as HTMLVideoElement).duration)).toBe(15);
});

test("date colours run from the earliest ride to the latest in cards and video", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([
    rideFit("middle.fit", 0, 300, new Date("2025-01-01T08:00:00Z")),
    rideFit("latest.fit", 2, 300, new Date("2026-01-01T08:00:00Z")),
    rideFit("earliest.fit", 4, 300, new Date("2024-01-01T08:00:00Z")),
  ]);
  await page.getByRole("button", { name: "Create 3 tracks", exact: true }).click();
  await page.getByLabel("Colors").selectOption("date");
  const color = (name: string) => page.locator("li", { hasText: name }).first().evaluate(element => getComputedStyle(element).getPropertyValue("--track-color").trim());
  expect(await color("earliest.fit")).toBe("#0ea5e9");
  expect(await color("latest.fit")).toBe("#f97316");
  await page.getByRole("button", { name: "Create video", exact: true }).click();
  await expect(page.getByText("Your video is ready.")).toBeVisible({ timeout: 180000 });
});

test("per-point colour modes use the rides' own data and export", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([rideFit("hilly.fit", 0, 600), rideFit("flat.fit", 3, 900)]);
  await page.getByRole("button", { name: "Create 2 tracks", exact: true }).click();
  const colors = page.getByLabel("Colors");
  for (const mode of ["elevation", "power30", "speed", "avgSpeed"]) {
    await colors.selectOption(mode);
    await expect(page.getByText(/shown in grey/)).toHaveCount(0);
  }
  await colors.selectOption("power30");
  await page.getByRole("button", { name: "Play animation", exact: true }).click();
  await page.getByRole("button", { name: "Create video", exact: true }).click();
  await expect(page.getByText("Your video is ready.")).toBeVisible({ timeout: 180000 });
});

test("rides without the chosen data are explained", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles([rideFit("with-power.fit", 0, 300), rideFit("no-power.fit", 3, 300, undefined, { power: false })]);
  await page.getByRole("button", { name: "Create 2 tracks", exact: true }).click();
  await page.getByLabel("Colors").selectOption("power30");
  await expect(page.getByText("1 ride has no power data and is shown in grey.")).toBeVisible();
});
