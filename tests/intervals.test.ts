import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFitUrl,
  activityListUrl,
  activityName,
  importLatestActivities,
  INTERVALS_IMPORT_LIMIT,
  mapWithConcurrency,
  retryAfterMs,
  usableActivity,
  waitWithSignal,
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

test("waitWithSignal rejects immediately on abort and does not wait out the timer", async () => {
  const controller = new AbortController();
  const reason = new Error("user cancelled");
  const started = Date.now();
  const promise = waitWithSignal(30_000, controller.signal);
  setTimeout(() => controller.abort(reason), 10);
  await assert.rejects(promise, error => error === reason);
  assert.ok(Date.now() - started < 1_000);

  // Already-aborted signal rejects synchronously without arming a timer.
  await assert.rejects(waitWithSignal(30_000, controller.signal), error => error === reason);
});

test("429 retry backoff aborts immediately when the signal is aborted", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new Error("cancelled during backoff");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    setTimeout(() => controller.abort(reason), 15);
    return new Response("busy", { status: 429, headers: { "retry-after": "30" } });
  }) as typeof fetch;
  try {
    const started = Date.now();
    await assert.rejects(
      importLatestActivities("valid-key", async () => ({ kind: "skipped", message: "unused" }), () => {}, controller.signal),
      error => error === reason,
    );
    assert.equal(calls, 1);
    assert.ok(Date.now() - started < 1_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
