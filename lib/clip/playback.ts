import { distanceBetween, type TrackPath } from "../track";

type Coordinate = [number, number];
/** Typed arrays keep large rides cheap; `latitudes` and `breaks` are shared with the track. */
export type PlaybackRoute = {
  latitudes: Float64Array;
  /** Unwrapped across the dateline so neighbours stay close. */
  longitudes: Float64Array;
  distances: Float64Array;
  breaks: Uint8Array;
  displayIndices: Uint32Array;
  totalDistance: number;
};

type PlaybackLocation = {
  index: number;
  ratio: number;
  position: Coordinate;
};

export const routeCoordinate = (route: PlaybackRoute, index: number): Coordinate => [route.latitudes[index], route.longitudes[index]];

export function createPlaybackRoute({ latitudes, longitudes: raw, breaks }: Pick<TrackPath, "latitudes" | "longitudes" | "breaks">): PlaybackRoute {
  const count = latitudes.length;
  if (count < 2) throw new Error("Playback requires at least two GPS points.");
  const longitudes = new Float64Array(count);
  const distances = new Float64Array(count);
  const displayIndices: number[] = [];
  let totalDistance = 0;
  // Keep the original points for accurate position; bound the growing preview line.
  const stride = Math.max(1, Math.ceil(count / 6000));
  for (let i = 0; i < count; i++) {
    longitudes[i] = i === 0 ? raw[0] : raw[i] + 360 * Math.round((longitudes[i - 1] - raw[i]) / 360);
    if (i > 0 && !breaks[i]) {
      totalDistance += distanceBetween({ latitude: latitudes[i - 1], longitude: longitudes[i - 1] }, { latitude: latitudes[i], longitude: longitudes[i] });
    }
    distances[i] = totalDistance;
    if (i === 0 || i === count - 1 || i % stride === 0 || breaks[i] || breaks[i + 1]) displayIndices.push(i);
  }
  return { latitudes, longitudes, distances, breaks, totalDistance, displayIndices: Uint32Array.from(displayIndices) };
}

export function playbackLocation(route: PlaybackRoute, progress: number): PlaybackLocation {
  const fraction = Math.min(1, Math.max(0, progress));
  const last = route.latitudes.length - 1;
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
  const next = Math.min(last, index + 1);
  const position: Coordinate = [
    route.latitudes[index] + (route.latitudes[next] - route.latitudes[index]) * ratio,
    route.longitudes[index] + (route.longitudes[next] - route.longitudes[index]) * ratio,
  ];
  return { index, ratio, position };
}

function sameCoordinate(left: Coordinate, right: Coordinate) {
  return left[0] === right[0] && left[1] === right[1];
}

/** Index into displayIndices of the first entry greater than `index`. */
function displayAfter(route: PlaybackRoute, index: number) {
  let low = 0;
  let high = route.displayIndices.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.displayIndices[middle] <= index) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function playbackPosition(route: PlaybackRoute, progress: number): Coordinate {
  return playbackLocation(route, progress).position;
}

/** A stretch of revealed route; `indices[k]` is the GPS point that `points[k]` reaches (for per-point colours). */
export type RouteSection = { points: Coordinate[]; indices: number[] };

/** Returns only the newly revealed route between two playback positions. */
export function playbackSlice(route: PlaybackRoute, fromProgress: number, toProgress: number): RouteSection[] {
  const startFraction = Math.min(1, Math.max(0, fromProgress));
  const endFraction = Math.min(1, Math.max(0, toProgress));
  if (endFraction <= startFraction) return [];

  const start = playbackLocation(route, startFraction);
  const end = playbackLocation(route, endFraction);
  const sections: RouteSection[] = [];
  let section: RouteSection = { points: [start.position], indices: [start.index] };

  const finishSection = () => {
    if (section.points.length > 1) sections.push(section);
  };

  for (let displayPosition = displayAfter(route, start.index); displayPosition < route.displayIndices.length; displayPosition++) {
    const displayIndex = route.displayIndices[displayPosition];
    if (displayIndex > end.index) break;
    if (route.breaks[displayIndex]) {
      finishSection();
      section = { points: [routeCoordinate(route, displayIndex)], indices: [displayIndex] };
    } else {
      section.points.push(routeCoordinate(route, displayIndex));
      section.indices.push(displayIndex);
    }
  }

  if (!sameCoordinate(section.points[section.points.length - 1], end.position)) {
    section.points.push(end.position);
    section.indices.push(Math.min(route.latitudes.length - 1, end.index + (end.ratio > 0 ? 1 : 0)));
  }
  finishSection();
  return sections;
}
