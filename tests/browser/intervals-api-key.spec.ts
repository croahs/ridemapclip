import { test, expect } from "@playwright/test";

test("API key goes only to Intervals.icu, is cleared from the form and never stored", async ({ page }) => {
  const intervals: string[] = [];
  const ownOrigin: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === new URL(page.url() || "http://127.0.0.1").origin && request.method() !== "GET") ownOrigin.push(request.url());
  });
  await page.route("https://intervals.icu/api/**", async route => {
    intervals.push(route.request().url());
    expect(await route.request().headerValue("authorization")).toBe("Basic " + Buffer.from("API_KEY:test-key").toString("base64"));
    await route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto("/");
  await page.getByLabel("API key", { exact: true }).fill("test-key");
  await page.getByRole("button", { name: "Import latest 100", exact: true }).click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.locator('p[role="alert"]')).toContainText("rejected this API key");
  expect(intervals).toHaveLength(1);
  expect(ownOrigin).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("test-key");
});
