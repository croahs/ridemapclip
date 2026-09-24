import type L from "leaflet";
import type { Track } from "./track";
import { mercator, type ClipView } from "./clip-renderer";
import { mapTileFilter, type MapTheme } from "./map-theme";
import { VIDEO_FORMATS, type VideoFormat } from "./video-format";
import type { MapFrame, RenderMessage, RenderRequest } from "./render-video-types";

export type VideoProgress = { fraction: number; message: string };

/** Snapshot only the already-visible map tiles; never bulk-download a map for export. */
async function capture(map: L.Map, theme: MapTheme, width: number, height: number, signal: AbortSignal) {
  map.stop();
  const mapElement = map.getContainer();
  const deadline = performance.now() + 20000;
  while (mapElement.querySelector(".leaflet-tile:not(.leaflet-tile-loaded)")) {
    signal.throwIfAborted();
    if (performance.now() > deadline) throw new Error("Some map tiles have not loaded. Wait for the map to finish loading and try again.");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  signal.throwIfAborted();
  const rect = mapElement.getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error("Open the map before creating a video.");
  const scale = Math.min(width / rect.width, height / rect.height);
  const offsetX = (width - rect.width * scale) / 2;
  const offsetY = (height - rect.height * scale) / 2;
  const background = document.createElement("canvas");
  background.width = width; background.height = height;
  const ctx = background.getContext("2d");
  if (!ctx) throw new Error("Your browser could not prepare the video canvas.");
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, width, height);
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
  if (!count) throw new Error("The background map is not loaded yet. Check your connection and try again.");
  try { ctx.getImageData(0, 0, 1, 1); } catch { throw new Error("The background map cannot be included in a video yet. Refresh the page to reload its tiles and try again."); }
  const zoom = map.getZoom();
  const [originX, originY] = mercator([map.getCenter().lat, map.getCenter().lng], zoom);
  const view: ClipView = { zoom, scale, dx: offsetX + (rect.width / 2 - originX) * scale, dy: offsetY + (rect.height / 2 - originY) * scale };
  const frame: MapFrame = { x: offsetX, y: offsetY, width: rect.width * scale, height: rect.height * scale };
  return { background: await createImageBitmap(background), view, frame };
}

/**
 * Renders the clip into an MP4 in a worker, so a hidden tab or a busy page
 * does not slow it down. Aborting terminates the worker immediately.
 */
export async function renderVideo(map: L.Map, tracks: Track[], clipMs: number, theme: MapTheme, format: VideoFormat, signal: AbortSignal, progress: (value: VideoProgress) => void): Promise<Blob> {
  const { width, height } = VIDEO_FORMATS[format];
  progress({ fraction: 0, message: "Preparing your map…" });
  const { background, view, frame } = await capture(map, theme, width, height, signal);
  const worker = new Worker(new URL("./render-video.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<RenderMessage>) => {
        const message = event.data;
        if (message.type === "progress") progress(message);
        else {
          signal.removeEventListener("abort", abort);
          if (message.type === "done") resolve(new Blob([message.buffer], { type: "video/mp4" }));
          else reject(new Error(message.message));
        }
      };
      worker.onerror = () => reject(new Error("The video renderer stopped unexpectedly. Please try again."));
      const request: RenderRequest = { tracks, clipMs, theme, width, height, background, view, frame };
      worker.postMessage(request, [background]);
    });
  } finally {
    worker.terminate();
  }
}
