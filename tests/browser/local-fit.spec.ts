import { test, expect } from "@playwright/test";
import { indoorFit, rideFit, stubTiles } from "./fixtures";

test("reads many FIT files in the browser without sending them anywhere", async ({ page }) => {
  const errors: string[] = [];
  const posts: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") posts.push(request.url()); });
  await stubTiles(page);
  await page.goto("/");
  const files = [...Array.from({ length: 40 }, (_, i) => rideFit(`ride-${i + 1}.fit`, i)), indoorFit("indoor-1.fit"), indoorFit("indoor-2.fit")];
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.getByRole("button", { name: "Create 42 tracks", exact: true }).click();
  await expect(page.getByText(/40 track\(s\) created/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/2 file\(s\) skipped/)).toBeVisible();
  await page.getByRole("button", { name: "Play animation", exact: true }).click();
  await expect.poll(() => page.getByLabel("Playback time").textContent()).not.toBe("0:00 / 0:30");
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
});

test("keeps FIT validation when parsing in the browser", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "damaged.fit", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
  await page.getByRole("button", { name: "Create 1 track", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("damaged.fit: This is not a complete FIT file");
  await expect(page.getByRole("button", { name: "Create 1 track", exact: true })).toBeEnabled();
});
