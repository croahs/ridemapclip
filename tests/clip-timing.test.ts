import assert from "node:assert/strict";
import { test } from "node:test";
import { trackDurationsMs, trackProgress } from "../lib/clip-timing";

test("two-hour ride takes 30 seconds and one-hour ride takes 15 seconds", () => {
  const durations = trackDurationsMs([{ movingSeconds: 7200 }, { movingSeconds: 3600 }]);
  assert.deepEqual(durations, [30000, 15000]);
  assert.equal(trackProgress(15000, durations[0]), 0.5);
  assert.equal(trackProgress(15000, durations[1]), 1);
  assert.equal(trackProgress(30000, durations[1]), 1);
});

test("five different rides preserve duration proportions regardless of order", () => {
  assert.deepEqual(trackDurationsMs([600, 3000, 1200, 2400, 1800].map(movingSeconds => ({movingSeconds}))), [6000, 30000, 12000, 24000, 18000]);
});

test("one ride, tied rides, and missing durations retain the 30-second clip", () => {
  assert.deepEqual(trackDurationsMs([{movingSeconds: 100}]), [30000]);
  assert.deepEqual(trackDurationsMs([{movingSeconds: 100}, {movingSeconds: 100}]), [30000, 30000]);
  assert.deepEqual(trackDurationsMs([null, 0, -1, NaN, Infinity, 100].map(movingSeconds => ({movingSeconds}))), Array(6).fill(30000));
  assert.deepEqual(trackDurationsMs([]), []);
  assert.equal(trackProgress(-1, 15000), 0);
});
