import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIP_DURATION_MS, CLIP_DURATION_SECONDS, ClipClock } from "../lib/clip";
import { createPlaybackRoute, playbackFrame, playbackSlice } from "../lib/playback";
import type { TrackPoint } from "../lib/track";
import { chronologicalTrailSlices } from "../lib/trail-order";

const point = (longitude: number, breakBefore = false): TrackPoint => ({ latitude: 0, longitude, timestamp: null, elevationMeters: null, breakBefore });

test("clip duration is locked at exactly 30 seconds, including late frames", () => {
  assert.equal(CLIP_DURATION_SECONDS, 30);
  assert.equal(CLIP_DURATION_MS, 30_000);
  const clock = new ClipClock();
  clock.play(100);
  assert.equal(clock.elapsed(100), 0);
  assert.equal(clock.elapsed(15_100), 15_000);
  assert.equal(clock.elapsed(30_100), 30_000);
  assert.equal(clock.elapsed(50_100), 30_000);
});

test("pause/resume preserves remaining duration; replay starts from zero", () => {
  const clock = new ClipClock();
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

test("progress uses distance, not sample count, and ends exactly at the finish", () => {
  const route = createPlaybackRoute([point(0), point(0.001), point(0.01)]);
  assert.deepEqual(playbackFrame(route, 0).position, [0, 0]);
  assert.ok(Math.abs(playbackFrame(route, 0.5).position[1] - 0.005) < 1e-9);
  assert.deepEqual(playbackFrame(route, 1).position, [0, 0.01]);
  assert.deepEqual(playbackFrame(route, 1.5).position, [0, 0.01]);
  assert.deepEqual(playbackFrame(route, -1).position, [0, 0]);
});

test("GPS gaps are neither interpolated nor connected by the revealed trail", () => {
  const route = createPlaybackRoute([point(0), point(1), point(10, true), point(11)]);
  assert.ok(playbackFrame(route, 0.49).position[1] < 1);
  assert.ok(playbackFrame(route, 0.51).position[1] > 10);
  const frame = playbackFrame(route, 1);
  assert.deepEqual(frame.sections, [[[0, 0], [0, 1]], [[0, 10], [0, 11]]]);
});

test("dateline playback takes the short path without circling the globe", () => {
  const route = createPlaybackRoute([point(179.9), point(-179.9)]);
  assert.ok(Math.abs(playbackFrame(route, 0.5).position[1] - 180) < 1e-9);
});

test("repeated locations and isolated GPS points produce finite positions", () => {
  for (const points of [[point(1), point(1), point(2)], [point(1), point(3, true), point(5, true)]]) {
    const route = createPlaybackRoute(points);
    for (const progress of [0, 0.25, 0.5, 0.99, 1]) {
      assert.ok(playbackFrame(route, progress).position.every(Number.isFinite));
    }
    assert.deepEqual(playbackFrame(route, 1).position, [0, points.at(-1)!.longitude]);
  }
});

test("large recordings keep accurate positions with a bounded preview trail", () => {
  const route = createPlaybackRoute(Array.from({ length: 200_000 }, (_, index) => point(index / 1_000_000)));
  assert.ok(route.displayIndices.length <= 6002);
  assert.equal(route.coordinates.length, 200_000);
  const frame = playbackFrame(route, 1);
  assert.deepEqual(frame.position, [0, 0.199999]);
  assert.ok(frame.sections[0].length <= 6002);
});

test("playback slices contain only the newly drawn route", () => {
  const route = createPlaybackRoute([point(0), point(0.001), point(0.01)]);
  const first = playbackSlice(route, 0, 0.5);
  const second = playbackSlice(route, 0.5, 1);
  assert.deepEqual(first[0][0], [0, 0]);
  assert.ok(Math.abs(first[0].at(-1)![1] - 0.005) < 1e-9);
  assert.ok(Math.abs(second[0][0][1] - 0.005) < 1e-9);
  assert.deepEqual(second[0].at(-1), [0, 0.01]);
  assert.deepEqual(playbackSlice(route, 0.75, 0.5), []);
});

test("playback slices keep recording gaps disconnected", () => {
  const route = createPlaybackRoute([point(0), point(1), point(10, true), point(11)]);
  const sections = playbackSlice(route, 0.25, 0.75);
  assert.equal(sections.length, 2);
  assert.ok(sections[0].at(-1)![1] <= 1);
  assert.ok(sections[1][0][1] >= 10);
});

test("new trail slices are ordered by when they were drawn", () => {
  const route = createPlaybackRoute([point(0), point(1)]);
  const slices = chronologicalTrailSlices([
    { route, durationMs: 1_000 },
    { route, durationMs: 500 },
  ], 0, 750);
  assert.deepEqual(slices.map(slice => slice.trackIndex), [1, 0]);
  assert.deepEqual(slices.map(slice => slice.drawnAtMs), [500, 750]);
});
