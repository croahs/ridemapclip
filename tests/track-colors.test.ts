import assert from "node:assert/strict";
import { test } from "node:test";
import { getTrackColor, TRACK_COLORS } from "../lib/clip/track-colors";

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
