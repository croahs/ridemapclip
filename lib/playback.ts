import { distanceBetween, type TrackPoint } from "./track";

type Coordinate = [number, number];
export type PlaybackRoute = {
  coordinates: Coordinate[];
  distances: number[];
  breaks: boolean[];
  displayIndices: number[];
  totalDistance: number;
};

type PlaybackLocation = {
  index: number;
  ratio: number;
  position: Coordinate;
};

export function createPlaybackRoute(points: TrackPoint[]): PlaybackRoute {
  if (points.length < 2) throw new Error("Playback requires at least two GPS points.");
  const coordinates: Coordinate[] = [];
  const distances: number[] = [];
  const displayIndices: number[] = [];
  let totalDistance = 0;
  // Keep the original points for accurate position; bound the growing preview line.
  const stride = Math.max(1, Math.ceil(points.length / 6000));
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    let longitude = point.longitude;
    if (i > 0) {
      longitude += 360 * Math.round((coordinates[i - 1][1] - longitude) / 360);
      if (!point.breakBefore) totalDistance += distanceBetween(points[i - 1], point);
    }
    coordinates.push([point.latitude, longitude]);
    distances.push(totalDistance);
    if (i === 0 || i === points.length - 1 || i % stride === 0 || point.breakBefore || points[i + 1]?.breakBefore) displayIndices.push(i);
  }
  return { coordinates, distances, totalDistance, displayIndices, breaks: points.map((point) => point.breakBefore) };
}

function playbackLocation(route: PlaybackRoute, progress: number): PlaybackLocation {
  const fraction = Math.min(1, Math.max(0, progress));
  const last = route.coordinates.length - 1;
  let index = 0;
  let ratio = 0;
  if (fraction >= 1) index = last;
  else if (fraction > 0 && route.totalDistance > 0) {
    const target = fraction * route.totalDistance;
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (route.distances[middle] <= target) low = middle;
      else high = middle - 1;
    }
    index = low;
    const distance = route.distances[index + 1] - route.distances[index];
    if (index < last && distance > 0 && !route.breaks[index + 1]) ratio = (target - route.distances[index]) / distance;
  } else if (fraction > 0) {
    // A recording made solely of isolated fixes has no drawable distance.
    // Step between fixes; never interpolate across missing GPS sections.
    index = Math.floor(fraction * last);
  }
  const current = route.coordinates[index];
  const next = route.coordinates[Math.min(last, index + 1)];
  const position: Coordinate = [current[0] + (next[0] - current[0]) * ratio, current[1] + (next[1] - current[1]) * ratio];
  return { index, ratio, position };
}

function sameCoordinate(left: Coordinate, right: Coordinate) {
  return left[0] === right[0] && left[1] === right[1];
}

export function playbackFrame(route: PlaybackRoute, progress: number): { position: Coordinate; sections: Coordinate[][] } {
  const { index, ratio, position } = playbackLocation(route, progress);
  const current = route.coordinates[index];
  const sections: Coordinate[][] = [];
  for (const displayIndex of route.displayIndices) {
    if (displayIndex > index) break;
    if (!sections.length || route.breaks[displayIndex]) sections.push([]);
    sections[sections.length - 1].push(route.coordinates[displayIndex]);
  }
  // Include the current original vertex so the moving tip stays on the track.
  const section = sections[sections.length - 1];
  if (section[section.length - 1] !== current) section.push(current);
  if (ratio > 0) section.push(position);
  return { position, sections };
}

/** Returns only the newly revealed route between two playback positions. */
export function playbackSlice(route: PlaybackRoute, fromProgress: number, toProgress: number): Coordinate[][] {
  const startFraction = Math.min(1, Math.max(0, fromProgress));
  const endFraction = Math.min(1, Math.max(0, toProgress));
  if (endFraction <= startFraction) return [];

  const start = playbackLocation(route, startFraction);
  const end = playbackLocation(route, endFraction);
  const sections: Coordinate[][] = [];
  let section: Coordinate[] = [start.position];

  const finishSection = () => {
    if (section.length > 1) sections.push(section);
  };

  let low = 0;
  let high = route.displayIndices.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.displayIndices[middle] <= start.index) low = middle + 1;
    else high = middle;
  }

  for (let displayPosition = low; displayPosition < route.displayIndices.length; displayPosition++) {
    const displayIndex = route.displayIndices[displayPosition];
    if (displayIndex > end.index) break;
    if (route.breaks[displayIndex]) {
      finishSection();
      section = [route.coordinates[displayIndex]];
    } else {
      section.push(route.coordinates[displayIndex]);
    }
  }

  if (!sameCoordinate(section[section.length - 1], end.position)) section.push(end.position);
  finishSection();
  return sections;
}
