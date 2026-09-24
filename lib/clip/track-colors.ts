// Shared order for track cards, map routes, and moving markers.
export const TRACK_COLORS = ["#0284c7", "#dc2626", "#7c3aed", "#059669", "#d97706"] as const;

/** "ride": a distinct colour per ride. "date": a gradient from the earliest to the latest ride. */
export type ColorMode = "ride" | "date";

/** Earliest → latest. Mid-lightness stops stay readable on both the dark and the light map. */
export const DATE_GRADIENT = ["#0ea5e9", "#8b5cf6", "#ec4899", "#f97316"] as const;
/** Rides without a start time in "date" mode. */
export const UNDATED_COLOR = "#94a3b8";

/**
 * Returns a high-contrast color for a track.
 * For <= 5 tracks, uses the hand-picked brand palette.
 * For > 5 tracks (up to 1000), uses the golden ratio hue distribution for maximum contrast between consecutive tracks.
 */
export function getTrackColor(index: number, totalTracks = 1): string {
  if (totalTracks <= TRACK_COLORS.length && index < TRACK_COLORS.length) {
    return TRACK_COLORS[index % TRACK_COLORS.length];
  }
  const hue = Math.round((index * 137.507764) % 360);
  return `hsl(${hue}, 80%, 50%)`;
}

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Colour at position 0–1 along DATE_GRADIENT. */
export function dateGradientColor(position: number): string {
  const scaled = Math.min(1, Math.max(0, position)) * (DATE_GRADIENT.length - 1);
  const stop = Math.min(DATE_GRADIENT.length - 2, Math.floor(scaled));
  const from = channels(DATE_GRADIENT[stop]);
  const to = channels(DATE_GRADIENT[stop + 1]);
  const mix = scaled - stop;
  return "#" + from.map((value, i) => Math.round(value + (to[i] - value) * mix).toString(16).padStart(2, "0")).join("");
}

type Dated = { startedAt: string | null };
const startTime = (track: Dated) => track.startedAt === null ? NaN : Date.parse(track.startedAt);

/** First and last ride start in the batch, or null when no ride has a date. */
export function trackDateRange(tracks: Dated[]): { first: number; last: number } | null {
  const times = tracks.map(startTime).filter(Number.isFinite);
  return times.length ? { first: Math.min(...times), last: Math.max(...times) } : null;
}

/** One colour per track. In "date" mode the position is linear in time between the first and last ride. */
export function trackColors(tracks: Dated[], mode: ColorMode): string[] {
  if (mode === "ride") return tracks.map((_, index) => getTrackColor(index, tracks.length));
  const range = trackDateRange(tracks);
  return tracks.map(track => {
    const time = startTime(track);
    if (!range || !Number.isFinite(time)) return UNDATED_COLOR;
    return dateGradientColor(range.last > range.first ? (time - range.first) / (range.last - range.first) : 0.5);
  });
}
