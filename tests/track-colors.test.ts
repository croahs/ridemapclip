import assert from "node:assert/strict";
import { test } from "node:test";
import { DATE_GRADIENT, UNDATED_COLOR, dateGradientColor, getTrackColor, trackColors, trackDateRange, TRACK_COLORS } from "../lib/clip/track-colors";

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
  assert.equal(colors[2], UNDATED_COLOR);
  assert.equal(colors[3], dateGradientColor(0.5));
  assert.deepEqual(trackDateRange(tracks), { first: Date.parse("2024-01-01T08:00:00Z"), last: Date.parse("2026-06-01T08:00:00Z") });
});

test("date mode handles one date, no dates, and ride mode keeps distinct colours", () => {
  assert.deepEqual(trackColors([{ startedAt: "2026-01-01T00:00:00Z" }, { startedAt: "2026-01-01T00:00:00Z" }], "date"), [dateGradientColor(0.5), dateGradientColor(0.5)]);
  assert.deepEqual(trackColors([{ startedAt: null }], "date"), [UNDATED_COLOR]);
  assert.equal(trackDateRange([{ startedAt: null }]), null);
  assert.deepEqual(trackColors([{ startedAt: null }, { startedAt: null }], "ride"), [TRACK_COLORS[0], TRACK_COLORS[1]]);
  assert.match(dateGradientColor(0.25), /^#[0-9a-f]{6}$/);
});
