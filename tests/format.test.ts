import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClipTime, formatDigitalTime, formatHumanDuration, formatRideElapsed } from "../lib/format";
import { currentTrackElapsedSeconds } from "../lib/clip";

test("formats digital times under an hour as MM:SS", () => {
  assert.equal(formatDigitalTime(0), "00:00");
  assert.equal(formatDigitalTime(65), "01:05");
  assert.equal(formatDigitalTime(599), "09:59");
  assert.equal(formatDigitalTime(3599), "59:59");
});

test("formats digital times of an hour or more as H:MM:SS", () => {
  assert.equal(formatDigitalTime(3600), "1:00:00");
  assert.equal(formatDigitalTime(3665), "1:01:05");
  assert.equal(formatDigitalTime(7325), "2:02:05");
});

test("alwaysShowHours flag forces H:MM:SS format even under an hour", () => {
  assert.equal(formatDigitalTime(0, true), "0:00:00");
  assert.equal(formatDigitalTime(125, true), "0:02:05");
});

test("handles null, negative, and invalid values gracefully", () => {
  assert.equal(formatDigitalTime(null), "--:--");
  assert.equal(formatDigitalTime(-10), "--:--");
  assert.equal(formatDigitalTime(NaN), "--:--");
  assert.equal(formatHumanDuration(null), "Not recorded");
  assert.equal(formatHumanDuration(-5), "Not recorded");
});

test("human duration formatting matches minutes and hours", () => {
  assert.equal(formatHumanDuration(45), "0m 45s");
  assert.equal(formatHumanDuration(125), "2m 5s");
  assert.equal(formatHumanDuration(3600), "1h 0m");
  assert.equal(formatHumanDuration(5430), "1h 30m");
});

test("currentTrackElapsedSeconds scales proportionally and caps at total duration", () => {
  // 1-hour ride finishing at 15s in clip (30s total clip)
  const durationMs = 15000;
  const totalSeconds = 3600;

  assert.equal(currentTrackElapsedSeconds(0, durationMs, totalSeconds), 0);
  assert.equal(currentTrackElapsedSeconds(7500, durationMs, totalSeconds), 1800);
  assert.equal(currentTrackElapsedSeconds(15000, durationMs, totalSeconds), 3600);
  // After finishing, caps at 3600
  assert.equal(currentTrackElapsedSeconds(20000, durationMs, totalSeconds), 3600);
  assert.equal(currentTrackElapsedSeconds(30000, durationMs, totalSeconds), 3600);

  // Missing or invalid elapsedSeconds returns null
  assert.equal(currentTrackElapsedSeconds(15000, durationMs, null), null);
  assert.equal(currentTrackElapsedSeconds(15000, durationMs, 0), null);
  assert.equal(currentTrackElapsedSeconds(15000, durationMs, -100), null);
});

test("formatRideElapsed formats hours and minutes as a single clean number", () => {
  assert.equal(formatRideElapsed(0, true), "0h 00m");
  assert.equal(formatRideElapsed(0, false), "0m");
  assert.equal(formatRideElapsed(900, true), "0h 15m");
  assert.equal(formatRideElapsed(900, false), "15m");
  assert.equal(formatRideElapsed(3600, true), "1h 00m");
  assert.equal(formatRideElapsed(3600, false), "1h 00m");
  assert.equal(formatRideElapsed(5040, true), "1h 24m");
  assert.equal(formatRideElapsed(5040, false), "1h 24m");
  assert.equal(formatRideElapsed(7320, false), "2h 02m");
  assert.equal(formatRideElapsed(null), "--");
  assert.equal(formatRideElapsed(-50), "--");
  assert.equal(formatRideElapsed(NaN), "--");
});

test("clip positions read as m:ss", () => {
  assert.equal(formatClipTime(0), "0:00");
  assert.equal(formatClipTime(7.9), "0:07");
  assert.equal(formatClipTime(105), "1:45");
  assert.equal(formatClipTime(120), "2:00");
});
