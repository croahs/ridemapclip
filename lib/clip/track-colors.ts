// Shared order for track cards, map routes, and moving markers.
export const TRACK_COLORS = ["#0284c7", "#dc2626", "#7c3aed", "#059669", "#d97706"] as const;

/**
 * Returns a high-contrast color for a track.
 * For <= 5 tracks, uses the hand-picked brand palette.
 * For > 5 tracks (up to 200+), uses the golden ratio hue distribution for maximum contrast between consecutive tracks.
 */
export function getTrackColor(index: number, totalTracks = 1): string {
  if (totalTracks <= TRACK_COLORS.length && index < TRACK_COLORS.length) {
    return TRACK_COLORS[index % TRACK_COLORS.length];
  }
  const hue = Math.round((index * 137.507764) % 360);
  return `hsl(${hue}, 80%, 50%)`;
}
