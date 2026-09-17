import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import path from "node:path";

test("imports all 198 sample FIT files without Vercel upload requests", async ({ page }) => {
  const errors: string[] = [];
  const uploads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/upload") uploads.push(request.url());
  });
  await page.goto("/");
  const files = readdirSync("fitexample").filter(name => name.endsWith(".fit")).map(name => path.resolve("fitexample", name));
  expect(files).toHaveLength(198);
  await page.locator('input[type="file"]').setInputFiles(files);
  await page.getByRole("button", { name: "Create 198 tracks", exact: true }).click();
  await expect(page.getByText(/194 track\(s\) created/)).toBeVisible({ timeout: 180000 });
  await expect(page.getByText(/4 file\(s\) skipped/)).toBeVisible();
  expect(uploads).toEqual([]);
  await page.getByRole("button", { name: "Play animation", exact: true }).click();
  await expect.poll(() => page.getByLabel("Playback time").textContent()).not.toBe("0:00 / 0:30");
  expect(errors).toEqual([]);
});

test("keeps FIT validation when parsing in the browser", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "damaged.fit", mimeType: "application/octet-stream", buffer: Buffer.from("invalid") });
  await page.getByRole("button", { name: "Create 1 track", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("damaged.fit: This is not a complete FIT file");
  await expect(page.getByRole("button", { name: "Create 1 track", exact: true })).toBeEnabled();
});
