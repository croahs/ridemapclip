import type L from "leaflet";
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";
import { createPlaybackRoute, playbackFrame } from "./playback";
import { trackDurationsMs, trackProgress } from "./clip-timing";
import { getTrackColor } from "./track-colors";
import { formatRideElapsed } from "./format";
import type { Track } from "./track";
import { CLIP_DURATION_MS } from "./clip";
import { VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FRAMES, VIDEO_FPS, videoFrameTiming, riderAppearance } from "./video-timing";
import { glowOpacityMultiplier, mapTileFilter, type MapTheme } from "./map-theme";

type Point = [number, number];
export type VideoProgress = { fraction: number; message: string };
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const check = (signal: AbortSignal) => signal.throwIfAborted();
function canvas() { const result = document.createElement("canvas"); result.width = VIDEO_WIDTH; result.height = VIDEO_HEIGHT; return result; }
function context(surface: HTMLCanvasElement) {
  const result = surface.getContext("2d");
  if (!result) throw new Error("Your browser could not prepare the video canvas.");
  return result;
}

/** Snapshot only the already-visible map tiles; never bulk-download a map for export. */
async function capture(map: L.Map, theme: MapTheme, signal: AbortSignal) {
  map.stop();
  const mapElement = map.getContainer();
  const deadline = performance.now() + 20000;
  while (mapElement.querySelector(".leaflet-tile:not(.leaflet-tile-loaded)")) {
    check(signal);
    if (performance.now() > deadline) throw new Error("Some map tiles have not loaded. Wait for the map to finish loading and try again.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(signal);
  const rect = mapElement.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error("Open the map before creating a video.");
  const scale = Math.min(VIDEO_WIDTH / rect.width, VIDEO_HEIGHT / rect.height);
  const offsetX = (VIDEO_WIDTH - rect.width * scale) / 2;
  const offsetY = (VIDEO_HEIGHT - rect.height * scale) / 2;
  const background = canvas();
  const ctx = context(background);
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  ctx.save();
  ctx.beginPath(); ctx.rect(offsetX, offsetY, rect.width * scale, rect.height * scale); ctx.clip();
  ctx.filter = mapTileFilter(theme);
  let count = 0;
  for (const tile of mapElement.querySelectorAll<HTMLImageElement>(".leaflet-tile-loaded")) {
    const bounds = tile.getBoundingClientRect();
    if (bounds.right <= rect.left || bounds.left >= rect.right || bounds.bottom <= rect.top || bounds.top >= rect.bottom) continue;
    if (!tile.complete || !tile.naturalWidth) throw new Error("A background tile failed to load. Reload the map and try again.");
    ctx.drawImage(tile, offsetX + (bounds.left - rect.left) * scale, offsetY + (bounds.top - rect.top) * scale, bounds.width * scale, bounds.height * scale);
    count++;
  }
  ctx.restore();
  if (!count) throw new Error("The background map is not loaded yet. Check your connection and try again.");
  try { ctx.getImageData(0, 0, 1, 1); } catch { throw new Error("The background map cannot be included in a video yet. Refresh the page to reload its tiles and try again."); }
  // Freeze the projection too: later map movement cannot change the rendered video.
  const origin = map.project(map.getCenter(), map.getZoom());
  const zoom = map.getZoom();
  const projected = new WeakMap<Point, Point>();
  const project = (point: Point): Point => {
    const cached = projected.get(point);
    if (cached) return cached;
    const p = map.project(point, zoom);
    const result: Point = [offsetX + (p.x - origin.x + rect.width / 2) * scale, offsetY + (p.y - origin.y + rect.height / 2) * scale];
    projected.set(point, result);
    return result;
  };
  return { background, project, scale, offsetX, offsetY, width: rect.width * scale, height: rect.height * scale };
}

function stroke(ctx: CanvasRenderingContext2D, sections: Point[][], color: string, width: number, alpha = 1) {
  ctx.beginPath();
  for (const section of sections) {
    if (!section.length) continue;
    ctx.moveTo(...section[0]);
    for (let i = 1; i < section.length; i++) ctx.lineTo(...section[i]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); ctx.globalAlpha = 1;
}

function tail(section: Point[], length: number): Point[] {
  if (!section.length) return [];
  const result = [section[section.length - 1]];
  let remaining = length;
  for (let i = section.length - 2; i >= 0 && remaining > 0; i--) {
    const last = result[result.length - 1];
    const next = section[i];
    const distance = Math.hypot(next[0] - last[0], next[1] - last[1]);
    if (distance > remaining) {
      result.push([last[0] + (next[0] - last[0]) * remaining / distance, last[1] + (next[1] - last[1]) * remaining / distance]);
      break;
    }
    result.push(next); remaining -= distance;
  }
  return result;
}

export async function renderVideo(map: L.Map, tracks: Track[], theme: MapTheme, signal: AbortSignal, progress: (value: VideoProgress) => void): Promise<Blob> {
  const quality = new Quality({ bitrate: 8_000_000 });
  if (!(await canEncodeVideo("avc", { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, quality }))) {
    throw new Error("This browser cannot create MP4 videos. Open the app in an up-to-date Chrome or Edge browser and try again.");
  }
  check(signal);
  progress({ fraction: 0, message: "Preparing your map…" });
  const snapshot = await capture(map, theme, signal);
  const surface = canvas();
  const ctx = context(surface);
  const glow = canvas();
  const glowCtx = context(glow);
  const large = tracks.length > 20;
  const durations = trackDurationsMs(tracks);
  const routes = tracks.map((track, i) => {
    const route = createPlaybackRoute(track.points);
    const color = getTrackColor(i, tracks.length);
    return { route, color, duration: durations[i] };
  });
  const longest = Math.max(0, ...tracks.map(track => track.movingSeconds ?? 0));
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(surface, { codec: "avc", quality, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  try {
    await output.start();
    for (let index = 0; index < VIDEO_FRAMES; index++) {
      check(signal);
      const timing = videoFrameTiming(index);
      ctx.drawImage(snapshot.background, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.rect(snapshot.offsetX, snapshot.offsetY, snapshot.width, snapshot.height); ctx.clip();
      const frames = routes.map(({ route, color, duration }) => {
        const frame = playbackFrame(route, trackProgress(timing.elapsedMs, duration));
        return { color, ...riderAppearance(timing.elapsedMs, duration), position: snapshot.project(frame.position), sections: frame.sections.map(section => section.map(snapshot.project)) };
      });
      // Glow below all lines; dots above all lines, matching the map preview.
      glowCtx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      for (const frame of frames) {
        if (!frame.glowOpacity) continue;
        for (const [length, weight, opacity] of [[64, 10, .2], [44, 8, .35], [26, 6, .6], [12, 3, .95]]) {
          stroke(glowCtx, [tail(frame.sections.at(-1)!, length * snapshot.scale)], "white", weight * .5 * (large ? .75 : 1) * snapshot.scale, opacity * frame.glowOpacity * glowOpacityMultiplier(theme));
        }
      }
      // Blur the combined glow once per frame, rather than once per rider/stroke.
      ctx.save(); ctx.filter = `blur(${1.5 * snapshot.scale}px)`; ctx.shadowColor = "white"; ctx.shadowBlur = 4 * snapshot.scale;
      ctx.drawImage(glow, 0, 0); ctx.restore();
      for (const frame of frames) stroke(ctx, frame.sections, frame.color, (large ? 1.125 : 1.875) * snapshot.scale);
      for (const frame of frames) {
        if (!frame.visible) continue;
        ctx.beginPath(); ctx.arc(...frame.position, (large ? 2.5 : 4) * snapshot.scale, 0, Math.PI * 2);
        ctx.fillStyle = frame.color; ctx.fill(); ctx.strokeStyle = "white"; ctx.lineWidth = (large ? 1 : 1.5) * snapshot.scale; ctx.stroke();
      }
      ctx.restore();
      ctx.font = "bold 32px Arial";
      const time = formatRideElapsed(longest > 0 ? longest * timing.elapsedMs / CLIP_DURATION_MS : null, longest >= 3600);
      ctx.fillStyle = "#0f172acc"; ctx.fillRect(24, 24, ctx.measureText(time).width + 32, 52);
      ctx.fillStyle = "white"; ctx.fillText(time, 40, 61);
      ctx.font = "18px Arial";
      const credit = "© OpenStreetMap contributors · openstreetmap.org/copyright";
      const creditWidth = ctx.measureText(credit).width;
      ctx.fillStyle = "#0f172add"; ctx.fillRect(VIDEO_WIDTH - creditWidth - 28, VIDEO_HEIGHT - 38, creditWidth + 28, 38);
      ctx.fillStyle = "white"; ctx.fillText(credit, VIDEO_WIDTH - creditWidth - 14, VIDEO_HEIGHT - 14);
      await source.add(timing.timestamp, timing.duration);
      progress({ fraction: (index + 1) / VIDEO_FRAMES * .98, message: `Rendering video… ${Math.round((index + 1) / VIDEO_FRAMES * 100)}%` });
      await pause();
    }
    check(signal);
    progress({ fraction: .99, message: "Finishing your MP4…" });
    source.close();
    await output.finalize();
    check(signal);
    if (!output.target.buffer) throw new Error("The video could not be saved. Please try again.");
    return new Blob([output.target.buffer], { type: "video/mp4" });
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled") await output.cancel();
    throw error;
  }
}
