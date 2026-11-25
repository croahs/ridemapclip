import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLIP_SECONDS, ClipClock, VIDEO_FPS, clampClipSeconds, riderAppearance,
  trackDurationsMs, trackProgress, videoFrameCount, videoFrameTiming,
} from "../lib/clip/timing";
import { VIDEO_FORMATS } from "../lib/clip/video-format";
import { riderTooltipContent } from "../lib/clip/tooltip";
import { createScene, applyColorScheme } from "../lib/clip/renderer";
import { colorScheme } from "../lib/clip/track-colors";
import type { Track } from "../lib/track";

test("clip length is chosen between 15 and 120 seconds, 30 by default", () => {
  assert.deepEqual(CLIP_SECONDS, { min: 15, max: 120, default: 30 });
  assert.equal(clampClipSeconds(45), 45);
  assert.equal(clampClipSeconds(44.6), 45);
  assert.equal(clampClipSeconds(5), 15);
  assert.equal(clampClipSeconds(500), 120);
  assert.equal(clampClipSeconds(NaN), 30);
});

test("the clock never runs past the clip, including late frames", () => {
  const clock = new ClipClock(45_000);
  clock.play(100);
  assert.equal(clock.elapsed(100), 0);
  assert.equal(clock.elapsed(15_100), 15_000);
  assert.equal(clock.elapsed(45_100), 45_000);
  assert.equal(clock.elapsed(90_100), 45_000);
});

test("pause/resume preserves remaining time; replay starts from zero", () => {
  const clock = new ClipClock(30_000);
  clock.play(0);
  clock.pause(10_000);
  assert.equal(clock.elapsed(60_000), 10_000);
  clock.play(60_000);
  clock.play(61_000);
  assert.equal(clock.elapsed(80_000), 30_000);
  clock.pause(80_000);
  clock.play(90_000);
  assert.equal(clock.elapsed(90_000), 0);
  clock.reset();
  assert.equal(clock.elapsed(100_000), 0);
});

test("the longest ride finishes at the clip end and shorter rides proportionally earlier", () => {
  const durations = trackDurationsMs([{ movingSeconds: 7200 }, { movingSeconds: 3600 }], 30_000);
  assert.deepEqual(durations, [30000, 15000]);
  assert.deepEqual(trackDurationsMs([{ movingSeconds: 7200 }, { movingSeconds: 3600 }], 120_000), [120000, 60000]);
  assert.equal(trackProgress(15000, durations[0]), 0.5);
  assert.equal(trackProgress(15000, durations[1]), 1);
  assert.deepEqual(trackDurationsMs([600, 3000, 1200, 2400, 1800].map(movingSeconds => ({ movingSeconds })), 30_000), [6000, 30000, 12000, 24000, 18000]);
});

test("one ride, tied rides, and missing durations use the full clip", () => {
  assert.deepEqual(trackDurationsMs([{ movingSeconds: 100 }], 15_000), [15000]);
  assert.deepEqual(trackDurationsMs([{ movingSeconds: 100 }, { movingSeconds: 100 }], 30_000), [30000, 30000]);
  assert.deepEqual(trackDurationsMs([null, 0, -1, NaN, Infinity, 100].map(movingSeconds => ({ movingSeconds })), 30_000), Array(6).fill(30000));
  assert.deepEqual(trackDurationsMs([], 30_000), []);
  assert.equal(trackProgress(-1, 15000), 0);
});

test("supported video formats have the requested aspect ratios", () => {
  assert.deepEqual(Object.values(VIDEO_FORMATS).map(format => format.label), ["16:9", "1:1", "9:16"]);
  assert.equal(VIDEO_FORMATS.landscape.width / VIDEO_FORMATS.landscape.height, 16 / 9);
  assert.equal(VIDEO_FORMATS.square.width / VIDEO_FORMATS.square.height, 1);
  assert.equal(VIDEO_FORMATS.portrait.width / VIDEO_FORMATS.portrait.height, 9 / 16);
});

test("contiguous frames encode exactly the clip length and include both endpoints", () => {
  for (const clipMs of [15_000, 30_000, 120_000]) {
    const frames = videoFrameCount(clipMs);
    assert.equal(frames, clipMs / 1000 * VIDEO_FPS);
    assert.equal(videoFrameTiming(0, clipMs).elapsedMs, 0);
    const last = videoFrameTiming(frames - 1, clipMs);
    assert.ok(Math.abs(last.timestamp + last.duration - clipMs / 1000) < 1e-9);
    assert.equal(last.elapsedMs, clipMs);
    for (let i = 1; i < frames; i++) assert.ok(Math.abs(videoFrameTiming(i, clipMs).timestamp - (videoFrameTiming(i - 1, clipMs).timestamp + 1 / VIDEO_FPS)) < 1e-10);
    assert.throws(() => videoFrameTiming(frames, clipMs));
  }
});

test("each rider dot stops at its own finish while its glow fades for one second", () => {
  assert.deepEqual(riderAppearance(14000, 15000, 30000), { visible: true, glowOpacity: 1 });
  assert.deepEqual(riderAppearance(15000, 15000, 30000), { visible: false, glowOpacity: 1 });
  assert.deepEqual(riderAppearance(15500, 15000, 30000), { visible: false, glowOpacity: .5 });
  assert.deepEqual(riderAppearance(16000, 15000, 30000), { visible: false, glowOpacity: 0 });
  assert.deepEqual(riderAppearance(30000, 30000, 30000), { visible: false, glowOpacity: 0 });
  assert.deepEqual(riderAppearance(60000, 60000, 60000), { visible: false, glowOpacity: 0 });
  assert.deepEqual(riderAppearance(0, 15000, 30000), { visible: true, glowOpacity: 1 });
});

test("riderTooltipContent builds a span with plain textContent and never assigns innerHTML", () => {
  const created: { tag: string; textContent: string | null; innerHTMLAssigned: boolean }[] = [];
  const doc = {
    createElement(tag: string) {
      const record = { tag, textContent: null as string | null, innerHTMLAssigned: false };
      created.push(record);
      return {
        get textContent() { return record.textContent; },
        set textContent(value: string | null) { record.textContent = value; },
        set innerHTML(_value: string) { record.innerHTMLAssigned = true; throw new Error("innerHTML must not be used"); },
      } as unknown as HTMLSpanElement;
    },
  };
  const payload = '<img src=x onerror="alert(1)">';
  const span = riderTooltipContent(0, payload, doc);
  assert.equal(created.length, 1);
  assert.equal(created[0].tag, "span");
  assert.equal(span.textContent, `1. ${payload}`);
  assert.equal(created[0].innerHTMLAssigned, false);
});

test("createScene and applyColorScheme reuse a precomputed ColorScheme", () => {
  const track: Track = {
    name: "Ride",
    movingSeconds: 100,
    distanceMeters: 1000,
    skippedRecords: 0,
    warnings: [],
    elapsedSeconds: 100,
    startedAt: "2026-09-15T08:00:00Z",
    endedAt: "2026-09-15T08:01:40Z",
    path: {
      latitudes: Float64Array.from([48.85, 48.86]),
      longitudes: Float64Array.from([2.35, 2.36]),
      breaks: Uint8Array.from([0, 0]),
      elevations: Float32Array.from([100, 200]),
      speeds: Float32Array.from([5, 10]),
      power30: Float32Array.from([150, 250]),
      heartRates: Float32Array.from([120, 160]),
    },
  };
  const elevScheme = colorScheme([track], "elevation");
  const scene = createScene([track], 30_000, elevScheme);
  assert.equal(scene.riders[0].color, elevScheme.rideColors[0]);
  assert.equal(scene.riders[0].pointColors, elevScheme.pointColors[0]);
  assert.deepEqual(scene.legend, elevScheme.legend);

  const rideScheme = colorScheme([track], "ride");
  applyColorScheme(scene, rideScheme);
  assert.equal(scene.riders[0].color, rideScheme.rideColors[0]);
  assert.equal(scene.riders[0].pointColors, null);
  assert.equal(scene.legend, null);
});
