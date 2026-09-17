import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFitUrl,
  activityListUrl,
  activityName,
  INTERVALS_IMPORT_LIMIT,
  mapWithConcurrency,
  retryAfterMs,
  usableActivity,
} from "../lib/intervals";

test("activity list requests the latest bounded batch with only required fields", () => {
  const url = new URL(activityListUrl());
  assert.equal(url.origin, "https://intervals.icu");
  assert.equal(url.pathname, "/api/v1/athlete/0/activities");
  assert.equal(url.searchParams.get("oldest"), "1970-01-01");
  assert.equal(url.searchParams.get("newest"), null);
  assert.equal(url.searchParams.get("limit"), String(INTERVALS_IMPORT_LIMIT));
  assert.equal(url.searchParams.get("fields"), "id,name,type,start_date_local,file_type,source");
});

test("empty Strava stubs and malformed activity IDs are rejected", () => {
  assert.equal(usableActivity({}), false);
  assert.equal(usableActivity({ id: "123" }), false);
  assert.equal(usableActivity({ id: "i123" }), true);
  assert.throws(() => activityFitUrl("../secret"));
});

test("activity names have useful fallbacks and optional dates", () => {
  assert.equal(activityName({ id: "i1", name: " Morning Ride ", start_date_local: "2026-09-17T07:00:00" }), "Morning Ride · 2026-09-17");
  assert.equal(activityName({ id: "i2", type: "Ride" }), "Ride");
});

test("Retry-After supports seconds and dates with a bounded delay", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  assert.equal(retryAfterMs("2", now), 2_000);
  assert.equal(retryAfterMs("Thu, 17 Sep 2026 12:00:05 GMT", now), 5_000);
  assert.equal(retryAfterMs("120", now), 30_000);
  assert.equal(retryAfterMs(null, now), 1_000);
});

test("bounded mapper visits every item without exceeding concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const visited: number[] = [];
  await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async item => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    visited.push(item);
    active--;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(visited.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});
