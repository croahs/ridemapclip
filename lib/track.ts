/**
 * A GPS path as parallel arrays (about 33 bytes per point): with up to 1000
 * rides, one object per point would cost gigabytes. `breaks[i]` is 1 when a
 * recording gap precedes point i. Per-point metrics are NaN where unknown:
 * elevation in metres, speed in m/s, 30-second average power in watts, and
 * heart rate in bpm (as recorded: it changes slowly enough to need no smoothing).
 */
export type TrackPath = {
  latitudes: Float64Array;
  longitudes: Float64Array;
  breaks: Uint8Array;
  elevations: Float32Array;
  speeds: Float32Array;
  power30: Float32Array;
  heartRates: Float32Array;
};

export type Track = {
  name: string;
  path: TrackPath;
  distanceMeters: number;
  elapsedSeconds: number | null;
  movingSeconds: number | null;
  startedAt: string | null;
  endedAt: string | null;
  skippedRecords: number;
  warnings: string[];
};

type LatLon = { latitude: number; longitude: number };

export function distanceBetween(a: LatLon, b: LatLon): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
