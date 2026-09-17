import { test, expect } from "@playwright/test";

test("API-key form works without OAuth configuration and clears the key on import", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/intervals/import", async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ apiKey: "test-key" });
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "fatal", message: "Intervals.icu rejected this API key." }) + "\n" });
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Connect Intervals.icu", exact: true })).toHaveCount(0);
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByRole("button", { name: "Import latest 100", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.locator('p[role="alert"]')).toContainText("rejected this API key");
  expect(requests).toBe(1);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("test-key");
});
