import assert from "node:assert/strict";
import { test } from "node:test";
import { DATE_GRADIENT, ELEVATION_GRADIENT, NO_DATA_COLOR, NO_DATA_INDEX, PALETTE_STEPS, SPEED_GRADIENT, colorScheme, dateGradientColor, getTrackColor, trackColors, trackDateRange, TRACK_COLORS } from "../lib/clip/track-colors";

test("returns curated colors for batches up to 5 tracks", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(getTrackColor(i, 5), TRACK_COLORS[i]);
  }
});

test("generates 200 distinct colors for 200 tracks", () => {
  const colors = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const color = getTrackColor(i, 200);
    assert.match(color, /^hsl\(\d+,\s*80%,\s*50%\)$/);
    colors.add(color);
  }
  // With 200 discrete integer hues from golden angle, we should have 200 unique colors
  assert.equal(colors.size, 200);
});

test("date mode runs from the earliest ride to the latest, linear in time", () => {
  const tracks = [
    { startedAt: "2026-06-01T08:00:00Z" },
    { startedAt: "2024-01-01T08:00:00Z" },
    { startedAt: null },
    { startedAt: "2025-03-17T08:00:00Z" },
  ];
  const colors = trackColors(tracks, "date");
  assert.equal(colors[1], DATE_GRADIENT[0]);
  assert.equal(colors[0], DATE_GRADIENT.at(-1));
  assert.equal(colors[2], NO_DATA_COLOR);
  assert.equal(colors[3], dateGradientColor(0.5));
  assert.deepEqual(trackDateRange(tracks), { first: Date.parse("2024-01-01T08:00:00Z"), last: Date.parse("2026-06-01T08:00:00Z") });
});

test("date mode handles one date, no dates, and ride mode keeps distinct colours", () => {
  assert.deepEqual(trackColors([{ startedAt: "2026-01-01T00:00:00Z" }, { startedAt: "2026-01-01T00:00:00Z" }], "date"), [dateGradientColor(0.5), dateGradientColor(0.5)]);
  assert.deepEqual(trackColors([{ startedAt: null }], "date"), [NO_DATA_COLOR]);
  assert.equal(trackDateRange([{ startedAt: null }]), null);
  assert.deepEqual(trackColors([{ startedAt: null }, { startedAt: null }], "ride"), [TRACK_COLORS[0], TRACK_COLORS[1]]);
  assert.match(dateGradientColor(0.25), /^#[0-9a-f]{6}$/);
});

const pathWith = (elevations: number[]) => ({
  elevations: Float32Array.from(elevations), speeds: new Float32Array(elevations.length).fill(NaN), power30: new Float32Array(elevations.length).fill(NaN),
});

test("elevation colours every point on one batch-wide green-to-red scale", () => {
  const low = { startedAt: null, path: pathWith(Array.from({ length: 100 }, (_, i) => i)) };
  const high = { startedAt: null, path: pathWith(Array.from({ length: 100 }, (_, i) => 100 + i)) };
  const flat = { startedAt: null, path: pathWith([NaN, NaN]) };
  const scheme = colorScheme([low, high, flat], "elevation");
  assert.equal(scheme.palette[0], ELEVATION_GRADIENT[0]);
  assert.equal(scheme.palette[PALETTE_STEPS - 1], ELEVATION_GRADIENT.at(-1));
  assert.equal(scheme.pointColors[0]![0], 0);
  assert.equal(scheme.pointColors[1]![99], PALETTE_STEPS - 1);
  assert.ok(scheme.pointColors[0]![99] < scheme.pointColors[1]![0] + 1);
  assert.deepEqual(Array.from(scheme.pointColors[2]!), [NO_DATA_INDEX, NO_DATA_INDEX]);
  assert.equal(scheme.rideColors[2], NO_DATA_COLOR);
  assert.equal(scheme.missing, 1);
  assert.match(scheme.legend!.from, / m$/);
});

test("a single spike does not flatten the per-point scale", () => {
  const values = Array.from({ length: 1000 }, (_, i) => i % 100);
  values[500] = 100_000;
  const scheme = colorScheme([{ startedAt: null, path: pathWith(values) }], "elevation");
  assert.equal(scheme.legend!.to, "98 m");
  assert.equal(scheme.pointColors[0]![500], PALETTE_STEPS - 1);
});

test("average speed gives each ride one colour from slowest to fastest", () => {
  const scheme = colorScheme([
    { startedAt: null, distanceMeters: 36_000, movingSeconds: 3600 },
    { startedAt: null, distanceMeters: 20_000, movingSeconds: 3600 },
    { startedAt: null, distanceMeters: 10_000, movingSeconds: null },
  ], "avgSpeed");
  assert.deepEqual(scheme.rideColors, [SPEED_GRADIENT.at(-1), SPEED_GRADIENT[0], NO_DATA_COLOR]);
  assert.deepEqual(scheme.pointColors, [null, null, null]);
  assert.deepEqual([scheme.legend!.from, scheme.legend!.to], ["20.0 km/h", "36.0 km/h"]);
  assert.equal(scheme.missing, 1);
});
