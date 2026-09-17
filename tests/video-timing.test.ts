import assert from "node:assert/strict";
import { test } from "node:test";
import { VIDEO_FRAMES, VIDEO_FPS, videoFrameTiming, riderAppearance } from "../lib/video-timing";

test("900 contiguous frames encode exactly 30 seconds and include both endpoints", () => {
  assert.equal(VIDEO_FRAMES, 900);
  assert.equal(VIDEO_FPS, 30);
  assert.equal(videoFrameTiming(0).elapsedMs, 0);
  const last = videoFrameTiming(VIDEO_FRAMES - 1);
  assert.equal(last.timestamp + last.duration, 30);
  assert.equal(last.elapsedMs, 30000);
  for (let i = 1; i < VIDEO_FRAMES; i++) assert.ok(Math.abs(videoFrameTiming(i).timestamp - (videoFrameTiming(i - 1).timestamp + 1 / VIDEO_FPS)) < 1e-10);
  assert.throws(() => videoFrameTiming(900));
});

test("each rider dot stops at its own finish while its glow fades for one second", () => {
  assert.deepEqual(riderAppearance(14000, 15000), {visible: true, glowOpacity: 1});
  assert.deepEqual(riderAppearance(15000, 15000), {visible: false, glowOpacity: 1});
  assert.deepEqual(riderAppearance(15500, 15000), {visible: false, glowOpacity: .5});
  assert.deepEqual(riderAppearance(16000, 15000), {visible: false, glowOpacity: 0});
  assert.deepEqual(riderAppearance(30000, 30000), {visible: false, glowOpacity: 0});
  assert.deepEqual(riderAppearance(0, 15000), {visible: true, glowOpacity: 1});
});
