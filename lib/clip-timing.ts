import { CLIP_DURATION_MS } from "./clip";

/** Missing durations are explicitly treated as full-length previews. */
export function trackDurationsMs(tracks: { movingSeconds: number | null }[]): number[] {
  const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;
  const longest = tracks.reduce((max, track) => valid(track.movingSeconds) ? Math.max(max, track.movingSeconds) : max, 0);
  return tracks.map((track) => valid(track.movingSeconds) && longest > 0
    ? CLIP_DURATION_MS * (track.movingSeconds / longest) : CLIP_DURATION_MS);
}

export function trackProgress(clipElapsedMs: number, trackDurationMs: number): number {
  return Math.max(0, Math.min(1, clipElapsedMs / trackDurationMs));
}

export function currentTrackElapsedSeconds(
  clipElapsedMs: number,
  trackDurationMs: number,
  totalElapsedSeconds: number | null
): number | null {
  if (totalElapsedSeconds === null || !Number.isFinite(totalElapsedSeconds) || totalElapsedSeconds <= 0) {
    return null;
  }
  const progress = trackProgress(clipElapsedMs, trackDurationMs);
  return progress * totalElapsedSeconds;
}
