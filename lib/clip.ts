/** Product rule: all clips are 30 seconds until the user explicitly changes it. */
export const CLIP_DURATION_SECONDS = 30;
export const CLIP_DURATION_MS = CLIP_DURATION_SECONDS * 1000;

/** Wall-clock based timing avoids duration drift when frames are dropped. */
export class ClipClock {
  private offset = 0;
  private startedAt: number | null = null;

  elapsed(now: number): number {
    return Math.min(CLIP_DURATION_MS, this.offset + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt)));
  }

  play(now: number) {
    if (this.startedAt !== null) return;
    if (this.offset >= CLIP_DURATION_MS) this.offset = 0;
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
