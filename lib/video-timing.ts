import { CLIP_DURATION_MS, CLIP_DURATION_SECONDS } from "./clip";

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_FPS = 30;
export const VIDEO_FRAMES = CLIP_DURATION_SECONDS * VIDEO_FPS;
export const GLOW_FADE_MS = 600;
export const DARK_MODE_GLOW_OPACITY = 0.5;

export function videoFrameTiming(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= VIDEO_FRAMES) throw new Error("Invalid video frame.");
  return {
    timestamp: index / VIDEO_FPS,
    duration: 1 / VIDEO_FPS,
    // Include the completed route in the last frame without adding a 901st frame.
    elapsedMs: index / (VIDEO_FRAMES - 1) * CLIP_DURATION_MS,
  };
}

export function riderAppearance(elapsedMs: number, finishMs: number) {
  return {
    visible: elapsedMs < finishMs,
    glowOpacity: Math.max(0, Math.min(1, (finishMs - elapsedMs) / Math.min(GLOW_FADE_MS, finishMs))),
  };
}
