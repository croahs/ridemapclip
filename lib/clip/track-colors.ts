import type { TrackPath } from "../track";

// Shared order for track cards, map routes, and moving markers.
export const TRACK_COLORS = ["#0284c7", "#dc2626", "#7c3aed", "#059669", "#d97706"] as const;

/**
 * How rides are coloured. "ride" and "date" and "avgSpeed" give each ride one colour;
 * "elevation", "power30", "speed" and "heartRate" colour every point, so a trail changes colour
 * along the route and the rider dot shows the current value.
 */
export type ColorMode = "ride" | "date" | "avgSpeed" | "elevation" | "power30" | "speed" | "heartRate";
type PointMetric = "elevations" | "speeds" | "power30" | "heartRates";

/** Low → high. Mid-lightness stops stay readable on both the dark and the light map. */
export const DATE_GRADIENT = ["#0ea5e9", "#8b5cf6", "#ec4899", "#f97316"] as const;
export const ELEVATION_GRADIENT = ["#22c55e", "#eab308", "#ef4444"] as const;
export const POWER_GRADIENT = ["#6366f1", "#d946ef", "#facc15"] as const;
export const SPEED_GRADIENT = ["#3b82f6", "#06b6d4", "#facc15", "#ef4444"] as const;
export const HEART_RATE_GRADIENT = ["#3b82f6", "#22c55e", "#eab308", "#ef4444"] as const;
/** Rides or points without data for the chosen mode. */
export const NO_DATA_COLOR = "#94a3b8";

const kmh = (metersPerSecond: number, digits: number) => `${(metersPerSecond * 3.6).toFixed(digits)} km/h`;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

export const COLOR_MODES: Record<ColorMode, { label: string; missing: string; gradient?: readonly string[]; metric?: PointMetric; format?: (value: number) => string }> = {
  ride: { label: "By ride", missing: "" },
  date: { label: "Date", missing: "no start time", gradient: DATE_GRADIENT, format: day },
  avgSpeed: { label: "Average speed", missing: "no moving time", gradient: SPEED_GRADIENT, format: value => kmh(value, 1) },
  elevation: { label: "Elevation", missing: "no elevation data", gradient: ELEVATION_GRADIENT, metric: "elevations", format: value => `${Math.round(value)} m` },
  power30: { label: "30 s power", missing: "no power data", gradient: POWER_GRADIENT, metric: "power30", format: value => `${Math.round(value)} W` },
  speed: { label: "Speed", missing: "no speed data", gradient: SPEED_GRADIENT, metric: "speeds", format: value => kmh(value, 0) },
  heartRate: { label: "Heart rate", missing: "no heart rate data", gradient: HEART_RATE_GRADIENT, metric: "heartRates", format: value => `${Math.round(value)} bpm` },
};

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

/** Colour at position 0–1 along a gradient of hex stops. */
export function gradientColor(stops: readonly string[], position: number): string {
  const scaled = Math.min(1, Math.max(0, position)) * (stops.length - 1);
  const stop = Math.min(stops.length - 2, Math.floor(scaled));
  const from = channels(stops[stop]);
  const to = channels(stops[stop + 1]);
  const mix = scaled - stop;
  return "#" + from.map((value, i) => Math.round(value + (to[i] - value) * mix).toString(16).padStart(2, "0")).join("");
}

export const dateGradientColor = (position: number) => gradientColor(DATE_GRADIENT, position);

/** What colouring needs from a track; everything but the start time is optional so tests stay small. */
export type ColorTrack = {
  startedAt: string | null;
  distanceMeters?: number;
  movingSeconds?: number | null;
  path?: Pick<TrackPath, PointMetric>;
};

const startTime = (track: ColorTrack) => track.startedAt === null ? NaN : Date.parse(track.startedAt);

/** First and last ride start in the batch, or null when no ride has a date. */
export function trackDateRange(tracks: ColorTrack[]): { first: number; last: number } | null {
  const times = tracks.map(startTime).filter(Number.isFinite);
  return times.length ? { first: Math.min(...times), last: Math.max(...times) } : null;
}

export type ColorLegend = { from: string; to: string; gradient: readonly string[] };

export type ColorScheme = {
  /** One colour per ride: cards, telemetry and (in per-ride modes) dots and trails. */
  rideColors: string[];
  /** Per-point modes only: palette index per point (NO_DATA_INDEX where unknown). */
  pointColors: (Uint8Array | null)[];
  palette: string[];
  legend: ColorLegend | null;
  /** Rides shown in NO_DATA_COLOR because they lack the chosen data. */
  missing: number;
};

export const PALETTE_STEPS = 32;
export const NO_DATA_INDEX = 255;

/** Robust batch range: the 2nd–98th percentile, so a single spike does not flatten the scale. */
function percentileRange(arrays: Float32Array[]): { min: number; max: number } | null {
  const total = arrays.reduce((sum, values) => sum + values.length, 0);
  const step = Math.max(1, Math.ceil(total / 200_000));
  const sample: number[] = [];
  let seen = 0;
  for (const values of arrays) {
    for (let i = 0; i < values.length; i++, seen++) {
      if (seen % step === 0 && Number.isFinite(values[i])) sample.push(values[i]);
    }
  }
  if (!sample.length) return null;
  sample.sort((a, b) => a - b);
  return { min: sample[Math.floor(0.02 * (sample.length - 1))], max: sample[Math.ceil(0.98 * (sample.length - 1))] };
}

const position = (value: number, range: { min: number; max: number }) => range.max > range.min ? (value - range.min) / (range.max - range.min) : 0.5;

export function colorScheme(tracks: ColorTrack[], mode: ColorMode): ColorScheme {
  const none = { pointColors: tracks.map(() => null), palette: [], legend: null, missing: 0 };
  const config = COLOR_MODES[mode];
  if (!config.gradient || !config.format) return { ...none, rideColors: tracks.map((_, index) => getTrackColor(index, tracks.length)) };
  const { gradient, format } = config;
  const palette = Array.from({ length: PALETTE_STEPS }, (_, step) => gradientColor(gradient, step / (PALETTE_STEPS - 1)));

  if (config.metric) {
    const metric = config.metric;
    const values = tracks.map(track => track.path?.[metric] ?? new Float32Array());
    const range = percentileRange(values);
    const pointColors = values.map(points => {
      const indices = new Uint8Array(points.length).fill(NO_DATA_INDEX);
      if (range) for (let i = 0; i < points.length; i++) {
        if (Number.isFinite(points[i])) indices[i] = Math.round(Math.min(1, Math.max(0, position(points[i], range))) * (PALETTE_STEPS - 1));
      }
      return indices;
    });
    // A ride's own colour (cards, telemetry) is the colour of its average value.
    const rideColors = values.map(points => {
      let sum = 0;
      let count = 0;
      for (const value of points) if (Number.isFinite(value)) { sum += value; count++; }
      return range && count ? gradientColor(gradient, position(sum / count, range)) : NO_DATA_COLOR;
    });
    return {
      rideColors, pointColors, palette,
      legend: range ? { from: format(range.min), to: format(range.max), gradient } : null,
      missing: rideColors.filter(color => color === NO_DATA_COLOR).length,
    };
  }

  const rideValues = tracks.map(track => mode === "date"
    ? startTime(track)
    : track.movingSeconds && track.distanceMeters ? track.distanceMeters / track.movingSeconds : NaN);
  const finite = rideValues.filter(Number.isFinite);
  const range = finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : null;
  const rideColors = rideValues.map(value => range && Number.isFinite(value) ? gradientColor(gradient, position(value, range)) : NO_DATA_COLOR);
  return {
    ...none, rideColors, palette,
    legend: range ? { from: format(range.min), to: format(range.max), gradient } : null,
    missing: rideValues.length - finite.length,
  };
}

/** One colour per track (see ColorScheme.rideColors). */
export const trackColors = (tracks: ColorTrack[], mode: ColorMode) => colorScheme(tracks, mode).rideColors;
