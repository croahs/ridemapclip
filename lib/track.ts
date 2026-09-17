// Keep the original samples and times for future playback and video rendering.
export type TrackPoint = {
  latitude: number;
  longitude: number;
  timestamp: string | null;
  elevationMeters: number | null;
  breakBefore: boolean;
};

export type Track = {
  name: string;
  points: TrackPoint[];
  distanceMeters: number;
  elapsedSeconds: number | null;
  movingSeconds: number | null;
  startedAt: string | null;
  endedAt: string | null;
  skippedRecords: number;
  warnings: string[];
};

export function distanceBetween(a: TrackPoint, b: TrackPoint): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/** Leaflet supports unwrapped longitude, which keeps dateline crossings local. */
export function mapSegments(points: TrackPoint[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let previousLongitude: number | undefined;
  for (const point of points) {
    let longitude = point.longitude;
    if (previousLongitude !== undefined) {
      longitude += 360 * Math.round((previousLongitude - longitude) / 360);
    }
    if (segments.length === 0 || point.breakBefore) segments.push([]);
    segments[segments.length - 1].push([point.latitude, longitude]);
    previousLongitude = longitude;
  }
  return segments;
}
