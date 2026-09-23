import { trackProgress } from "./clip-timing";
import { playbackSlice, type PlaybackRoute } from "./playback";

export type TimedTrail = {
  route: PlaybackRoute;
  durationMs: number;
};

/**
 * Returns newly drawn route slices from oldest to newest. Stable track order is
 * used only when two slices end on the same video/preview frame.
 */
export function chronologicalTrailSlices<T extends TimedTrail>(trails: T[], fromMs: number, toMs: number) {
  return trails.map((trail, trackIndex) => ({
    ...trail,
    trackIndex,
    drawnAtMs: Math.min(toMs, trail.durationMs),
    sections: playbackSlice(
      trail.route,
      trackProgress(fromMs, trail.durationMs),
      trackProgress(toMs, trail.durationMs),
    ),
  })).filter(trail => trail.sections.length)
    .sort((left, right) => left.drawnAtMs - right.drawnAtMs || left.trackIndex - right.trackIndex);
}
