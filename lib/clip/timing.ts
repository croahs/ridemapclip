/** The user picks the clip length; preview, video and ride timing all scale to it. */
export const CLIP_SECONDS = { min: 15, max: 120, default: 30 } as const;
export const VIDEO_FPS = 30;
/** A finished rider's glow fades over this long instead of vanishing in one frame. */
export const GLOW_FADE_MS = 1_000;

export function clampClipSeconds(value: number): number {
  if (!Number.isFinite(value)) return CLIP_SECONDS.default;
  return Math.round(Math.min(CLIP_SECONDS.max, Math.max(CLIP_SECONDS.min, value)));
}

/** Wall-clock based timing avoids duration drift when frames are dropped. */
export class ClipClock {
  private offset = 0;
  private startedAt: number | null = null;

  constructor(private readonly durationMs: number) {}

  elapsed(now: number): number {
    return Math.min(this.durationMs, this.offset + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt)));
  }

  play(now: number) {
    if (this.startedAt !== null) return;
    if (this.offset >= this.durationMs) this.offset = 0;
    this.startedAt = now;
  }

  pause(now: number) {
    this.offset = this.elapsed(now);
    this.startedAt = null;
  }

  reset() {
    this.offset = 0;
    this.startedAt = null;
  }
}

/**
 * When each track finishes in the clip: the longest moving time finishes at the
 * end, shorter rides proportionally earlier. Missing durations use the full clip.
 */
export function trackDurationsMs(tracks: { movingSeconds: number | null }[], clipMs: number): number[] {
  const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;
  const longest = tracks.reduce((max, track) => valid(track.movingSeconds) ? Math.max(max, track.movingSeconds) : max, 0);
  return tracks.map((track) => valid(track.movingSeconds) && longest > 0 ? clipMs * (track.movingSeconds / longest) : clipMs);
}

export function trackProgress(clipElapsedMs: number, trackDurationMs: number): number {
  return Math.max(0, Math.min(1, clipElapsedMs / trackDurationMs));
}

export function currentTrackElapsedSeconds(clipElapsedMs: number, trackDurationMs: number, totalElapsedSeconds: number | null): number | null {
  if (totalElapsedSeconds === null || !Number.isFinite(totalElapsedSeconds) || totalElapsedSeconds <= 0) return null;
  return trackProgress(clipElapsedMs, trackDurationMs) * totalElapsedSeconds;
}

/** The rider dot stops at its finish; its glow lingers and fades, and is gone by the clip end. */
export function riderAppearance(elapsedMs: number, finishMs: number, clipMs: number) {
  if (elapsedMs >= clipMs) return { visible: false, glowOpacity: 0 };
  return {
    visible: elapsedMs < finishMs,
    glowOpacity: Math.max(0, Math.min(1, (finishMs + GLOW_FADE_MS - elapsedMs) / GLOW_FADE_MS)),
  };
}

export function videoFrameCount(clipMs: number): number {
  return Math.round(clipMs / 1000 * VIDEO_FPS);
}

export function videoFrameTiming(index: number, clipMs: number) {
  const frames = videoFrameCount(clipMs);
  if (!Number.isInteger(index) || index < 0 || index >= frames) throw new Error("Invalid video frame.");
  return {
    timestamp: index / VIDEO_FPS,
    duration: 1 / VIDEO_FPS,
    // Include the completed route in the last frame without adding an extra frame.
    elapsedMs: index / (frames - 1) * clipMs,
  };
}
