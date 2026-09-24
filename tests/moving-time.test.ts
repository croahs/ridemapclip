import assert from "node:assert/strict";
import { test } from "node:test";
import { Encoder, Profile } from "@garmin/fitsdk";
import { movingTime } from "../lib/fit/moving-time";
import { parseFit } from "../lib/fit/parse";
import { trackDurationsMs } from "../lib/clip/timing";
import type { TrackPoint } from "../lib/fit/types";
const send = (encoder: Encoder, number: number, message: Record<string, unknown>) => encoder.onMesg(number, message);
const start = Date.parse("2026-09-15T08:00:00Z");
const date = (seconds: number) => new Date(start + seconds * 1000);
const point = (seconds: number, latitude = 48 + seconds * 0.0001): TrackPoint => ({ latitude, longitude: 2, timestamp: date(seconds).toISOString(), breakBefore: false });
test("device moving time takes precedence over elapsed duration and estimates", () => {
  assert.deepEqual(movingTime([point(0), point(60)], [null, 5], [], [{totalMovingTime: 20}, {totalMovingTime: 10}]), {seconds: 30, estimated: false});
});
test("zero speed pauses do not contribute to moving time", () => {
  assert.equal(movingTime([point(0), point(10), point(20), point(30)], [5, 5, 0, 5], [], []).seconds, 20);
});
test("partial timer pauses and an unclosed stop are excluded", () => {
  const events = [
    {timestamp: date(4), event: "timer", eventType: "stopAll"},
    {timestamp: date(8), event: "timer", eventType: "start"},
    {timestamp: date(15), event: "timer", eventType: "stopDisableAll"},
  ];
  assert.equal(movingTime([point(0), point(10), point(20)], [5, 5, 5], events, []).seconds, 11);
});
test("GPS fallback excludes stationary fixes, drift and recording gaps", () => {
  const points = [point(0), point(10), point(20, 48.001), point(30, 48.001001), {...point(200), breakBefore: true}, point(210)];
  assert.equal(movingTime(points, points.map(() => null), [], []).seconds, 20);
});
test("missing timing remains unknown", () => {
  assert.equal(movingTime([{...point(0), timestamp: null}, {...point(10), timestamp: null}], [null, null], [], []).seconds, null);
});
test("binary FIT parsing carries moving time through to clip normalization", () => {
  const encoder = new Encoder();
  send(encoder, Profile.MesgNum.FILE_ID, {type: "activity", manufacturer: "development", timeCreated: date(0)});
  for (const seconds of [0, 10, 20]) send(encoder, Profile.MesgNum.RECORD, {
    timestamp: date(seconds), positionLat: Math.round((48 + seconds * 0.0001) * 2 ** 31 / 180), positionLong: Math.round(2 * 2 ** 31 / 180), speed: 5,
  });
  send(encoder, Profile.MesgNum.SESSION, {timestamp: date(20), totalElapsedTime: 20, totalTimerTime: 15, totalMovingTime: 10});
  const track = parseFit(new Uint8Array(encoder.close()).buffer, "paused.fit");
  assert.equal(track.elapsedSeconds, 20);
  assert.equal(track.movingSeconds, 10);
  assert.deepEqual(trackDurationsMs([track, {movingSeconds: 20}], 30_000), [15000, 30000]);
});
test("binary FIT timer events exclude stopped time when no moving summary exists", () => {
  const encoder = new Encoder();
  send(encoder, Profile.MesgNum.FILE_ID, {type: "activity", manufacturer: "development", timeCreated: date(0)});
  for (const seconds of [0, 10, 20]) send(encoder, Profile.MesgNum.RECORD, {
    timestamp: date(seconds), positionLat: Math.round((48 + seconds * 0.0001) * 2 ** 31 / 180), positionLong: Math.round(2 * 2 ** 31 / 180), speed: 5,
  });
  send(encoder, Profile.MesgNum.EVENT, {timestamp: date(5), event: "timer", eventType: "stopAll"});
  send(encoder, Profile.MesgNum.EVENT, {timestamp: date(15), event: "timer", eventType: "start"});
  assert.equal(parseFit(new Uint8Array(encoder.close()).buffer, "timer.fit").movingSeconds, 10);
});
