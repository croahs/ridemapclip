import { createPlaybackRoute, playbackLocation, routeCoordinate, type PlaybackRoute } from "./playback";
import { chronologicalTrailSlices } from "./trail-order";
import { NO_DATA_COLOR, NO_DATA_INDEX, colorScheme, type ColorLegend, type ColorMode } from "./track-colors";
import { glowOpacityMultiplier, type MapTheme } from "./map-theme";
import { formatRideElapsed } from "../format";
import { riderAppearance, trackDurationsMs, trackProgress } from "./timing";
import type { Track } from "../track";

export type Point = [number, number];
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * How a clip looks. Sizes are map (CSS) pixels; the video multiplies them by
 * its view scale, so preview and video match. Overlay sizes are in units of
 * 1/1080 of the frame's shorter side.
 */
export const CLIP_STYLE = {
  largePackAbove: 20,
  trailWidth: { normal: 1.875, large: 1.125 },
  riderRadius: { normal: 4, large: 2.5 },
  riderOutline: { normal: 1.5, large: 1 },
  glowLayers: [
    { length: 64, width: 5, opacity: 0.2 },
    { length: 44, width: 4, opacity: 0.35 },
    { length: 26, width: 3, opacity: 0.6 },
    { length: 12, width: 1.5, opacity: 0.95 },
  ],
  glowLargeScale: 0.75,
  glowBlur: 1.5,
  glowShadow: 4,
  fitPadding: 35,
  watermark: "ridemapclip.vercel.app",
  attribution: "© OpenStreetMap contributors · openstreetmap.org/copyright",
} as const;

/**
 * Where the map sits on a canvas: canvas = mercator(point, zoom) × scale + (dx, dy).
 * The preview uses scale 1; the video scales the captured map up to its size.
 */
export type ClipView = { zoom: number; scale: number; dx: number; dy: number };

/** A route in Mercator pixels at one zoom, without sub-pixel detail, for cheap glow tails. */
type PixelRoute = { points: Point[]; source: number[]; sectionStart: boolean[] };

/** `pointColors` (palette indices per GPS point) is set only in per-point colour modes. */
type Rider = { route: PlaybackRoute; color: string; pointColors: Uint8Array | null; durationMs: number };
export type ClipScene = {
  clipMs: number; riders: Rider[]; large: boolean; longestSeconds: number;
  palette: string[]; legend: ColorLegend | null; pixelRoutes: Map<string, PixelRoute[]>;
};

export function createScene(tracks: Track[], clipMs: number, colorMode: ColorMode): ClipScene {
  const durations = trackDurationsMs(tracks, clipMs);
  const scene: ClipScene = {
    clipMs,
    riders: tracks.map((track, index) => ({ route: createPlaybackRoute(track.path), color: "", pointColors: null, durationMs: durations[index] })),
    large: tracks.length > CLIP_STYLE.largePackAbove,
    longestSeconds: Math.max(0, ...tracks.map(track => track.movingSeconds ?? 0)),
    palette: [],
    legend: null,
    pixelRoutes: new Map(),
  };
  recolorScene(scene, tracks, colorMode);
  return scene;
}

/** Applies a colour mode to an existing scene (no routes are rebuilt). */
export function recolorScene(scene: ClipScene, tracks: Track[], colorMode: ColorMode) {
  const scheme = colorScheme(tracks, colorMode);
  scene.riders.forEach((rider, index) => {
    rider.color = scheme.rideColors[index];
    rider.pointColors = scheme.pointColors[index];
  });
  scene.palette = scheme.palette;
  scene.legend = scheme.legend;
}

const paletteColor = (scene: ClipScene, index: number) => index === NO_DATA_INDEX ? NO_DATA_COLOR : scene.palette[index];

const size = (scene: ClipScene, value: { normal: number; large: number }) => scene.large ? value.large : value.normal;

/** Web Mercator in Leaflet's pixel space, so any context can project without a map. */
export function mercator([latitude, longitude]: Point, zoom: number): Point {
  const scale = 256 * 2 ** zoom;
  const sin = Math.sin(Math.max(-85.0511287798, Math.min(85.0511287798, latitude)) * Math.PI / 180);
  return [scale * (longitude / 360 + 0.5), scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))];
}

const toCanvas = (view: ClipView, [x, y]: Point): Point => [x * view.scale + view.dx, y * view.scale + view.dy];
const project = (view: ClipView, coordinate: Point) => toCanvas(view, mercator(coordinate, view.zoom));

/** Keeps gap boundaries and the ends; drops vertices closer than `spacing` to the last kept one. */
export function pixelRoute(route: PlaybackRoute, zoom: number, spacing: number): PixelRoute {
  const points: Point[] = [];
  const source: number[] = [];
  const sectionStart: boolean[] = [];
  const last = route.latitudes.length - 1;
  for (let index = 0; index <= last; index++) {
    const point = mercator(routeCoordinate(route, index), zoom);
    const start = index === 0 || route.breaks[index] === 1;
    const previous = points[points.length - 1];
    if (!start && index !== last && !route.breaks[index + 1] && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < spacing) continue;
    points.push(point); source.push(index); sectionStart.push(start);
  }
  return { points, source, sectionStart };
}

function pixelRoutes(scene: ClipScene, view: ClipView) {
  // Half a canvas pixel of detail is invisible under the glow blur.
  const key = `${view.zoom}:${view.scale}`;
  let routes = scene.pixelRoutes.get(key);
  if (!routes) {
    routes = scene.riders.map(({ route }) => pixelRoute(route, view.zoom, 0.5 / view.scale));
    scene.pixelRoutes.set(key, routes);
  }
  return routes;
}

/** Up to `length` of route behind `tip` (Mercator pixels), from the rider backwards; stops at recording gaps. */
export function pixelTail(route: PixelRoute, index: number, tip: Point, length: number): Point[] {
  let low = 0;
  let high = route.source.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (route.source[middle] <= index) low = middle;
    else high = middle - 1;
  }
  const result = [tip];
  let remaining = length;
  for (let vertex = low; vertex >= 0 && remaining > 0; vertex--) {
    const last = result[result.length - 1];
    const point = route.points[vertex];
    const distance = Math.hypot(point[0] - last[0], point[1] - last[1]);
    if (distance > remaining) {
      result.push([last[0] + (point[0] - last[0]) * remaining / distance, last[1] + (point[1] - last[1]) * remaining / distance]);
      break;
    }
    result.push(point);
    remaining -= distance;
    if (route.sectionStart[vertex]) break;
  }
  return result;
}

/** Cuts a polyline (tip first) to a length. */
function cut(points: Point[], length: number): Point[] {
  const result = [points[0]];
  let remaining = length;
  for (let i = 1; i < points.length && remaining > 0; i++) {
    const last = result[result.length - 1];
    const distance = Math.hypot(points[i][0] - last[0], points[i][1] - last[1]);
    if (distance > remaining) {
      result.push([last[0] + (points[i][0] - last[0]) * remaining / distance, last[1] + (points[i][1] - last[1]) * remaining / distance]);
      break;
    }
    result.push(points[i]); remaining -= distance;
  }
  return result;
}

function stroke(ctx: Context, sections: Point[][], color: string, width: number, alpha = 1) {
  ctx.beginPath();
  for (const section of sections) {
    if (!section.length) continue;
    ctx.moveTo(...section[0]);
    for (let i = 1; i < section.length; i++) ctx.lineTo(...section[i]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); ctx.globalAlpha = 1;
}

/**
 * Draws only the route revealed between two instants onto a persistent trail
 * layer. Slices are drawn oldest first, so the latest rider stays on top.
 */
export function drawTrails(ctx: Context, scene: ClipScene, fromMs: number, toMs: number, view: ClipView) {
  const width = size(scene, CLIP_STYLE.trailWidth) * view.scale;
  for (const slice of chronologicalTrailSlices(scene.riders, fromMs, toMs)) {
    const sections = slice.sections.map(section => ({ points: section.points.map(coordinate => project(view, coordinate)), indices: section.indices }));
    if (!slice.pointColors) {
      stroke(ctx, sections.map(section => section.points), slice.color, width);
      continue;
    }
    // Per-point colours: one path per run of equal colour, not one per segment.
    for (const { points, indices } of sections) {
      let runColor = -1;
      let run: Point[] = [];
      for (let k = 1; k < points.length; k++) {
        const color = slice.pointColors[indices[k]];
        if (color !== runColor) {
          if (run.length > 1) stroke(ctx, [run], paletteColor(scene, runColor), width);
          run = [points[k - 1]];
          runColor = color;
        }
        run.push(points[k]);
      }
      if (run.length > 1) stroke(ctx, [run], paletteColor(scene, runColor), width);
    }
  }
}

/** Glow tails behind each rider. Draw onto a layer that is then blurred (CLIP_STYLE.glowBlur/glowShadow). */
export function drawGlow(ctx: Context, scene: ClipScene, elapsedMs: number, theme: MapTheme, view: ClipView) {
  const routes = pixelRoutes(scene, view);
  const widthScale = (scene.large ? CLIP_STYLE.glowLargeScale : 1) * view.scale;
  scene.riders.forEach(({ route, durationMs }, rider) => {
    const { glowOpacity } = riderAppearance(elapsedMs, durationMs, scene.clipMs);
    if (!glowOpacity) return;
    const { index, position } = playbackLocation(route, trackProgress(elapsedMs, durationMs));
    // Canvas lengths are Mercator lengths × scale, so the tail length needs no conversion.
    const tail = pixelTail(routes[rider], index, mercator(position, view.zoom), CLIP_STYLE.glowLayers[0].length).map(point => toCanvas(view, point));
    for (const layer of CLIP_STYLE.glowLayers) {
      stroke(ctx, [cut(tail, layer.length * view.scale)], "white", layer.width * widthScale, layer.opacity * glowOpacity * glowOpacityMultiplier(theme));
    }
  });
}

/** Rider dots, above everything else. Returns their canvas positions (null when hidden). */
export function drawRiders(ctx: Context, scene: ClipScene, elapsedMs: number, view: ClipView): (Point | null)[] {
  return scene.riders.map(({ route, color, pointColors, durationMs }) => {
    if (!riderAppearance(elapsedMs, durationMs, scene.clipMs).visible) return null;
    const location = playbackLocation(route, trackProgress(elapsedMs, durationMs));
    const position = project(view, location.position);
    ctx.beginPath(); ctx.arc(...position, size(scene, CLIP_STYLE.riderRadius) * view.scale, 0, Math.PI * 2);
    // In per-point modes the dot shows the value where the rider is now.
    ctx.fillStyle = pointColors ? paletteColor(scene, pointColors[location.index]) : color; ctx.fill();
    ctx.strokeStyle = "white"; ctx.lineWidth = size(scene, CLIP_STYLE.riderOutline) * view.scale; ctx.stroke();
    return position;
  });
}

/** Ride-time badge, watermark and (for video) map attribution, relative to the whole frame. */
export function drawOverlays(ctx: Context, scene: ClipScene, elapsedMs: number, width: number, height: number, attribution: boolean) {
  const unit = Math.min(width, height) / 1080;
  const box = (text: string, font: string, y: number, boxHeight: number, baseline: number, fill: string) => {
    ctx.font = font;
    ctx.fillStyle = fill; ctx.fillRect(24 * unit, y * unit, ctx.measureText(text).width + 32 * unit, boxHeight * unit);
    ctx.fillStyle = "white"; ctx.fillText(text, 40 * unit, (y + baseline) * unit);
  };
  const time = formatRideElapsed(scene.longestSeconds > 0 ? scene.longestSeconds * elapsedMs / scene.clipMs : null, scene.longestSeconds >= 3600);
  box(time, `bold ${32 * unit}px Arial`, 24, 52, 37, "#0f172acc");
  box(CLIP_STYLE.watermark, `bold ${18 * unit}px Arial`, 88, 36, 24, "#0f172a99");
  if (scene.legend) {
    // low value ▬▬ high value, with the bar in the same gradient the rides use.
    ctx.font = `${16 * unit}px Arial`;
    const { from: first, to: last, gradient: stops } = scene.legend;
    const firstWidth = ctx.measureText(first).width;
    const barX = 40 * unit + firstWidth + 10 * unit;
    const barWidth = 120 * unit;
    ctx.fillStyle = "#0f172a99";
    ctx.fillRect(24 * unit, 136 * unit, firstWidth + barWidth + ctx.measureText(last).width + 52 * unit, 34 * unit);
    ctx.fillStyle = "white";
    ctx.fillText(first, 40 * unit, 158 * unit);
    ctx.fillText(last, barX + barWidth + 10 * unit, 158 * unit);
    const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    stops.forEach((color, index) => gradient.addColorStop(index / (stops.length - 1), color));
    ctx.fillStyle = gradient;
    ctx.fillRect(barX, 148 * unit, barWidth, 10 * unit);
  }
  if (!attribution) return;
  ctx.font = `${18 * unit}px Arial`;
  const creditWidth = ctx.measureText(CLIP_STYLE.attribution).width;
  ctx.fillStyle = "#0f172add"; ctx.fillRect(width - creditWidth - 28 * unit, height - 38 * unit, creditWidth + 28 * unit, 38 * unit);
  ctx.fillStyle = "white"; ctx.fillText(CLIP_STYLE.attribution, width - creditWidth - 14 * unit, height - 14 * unit);
}
