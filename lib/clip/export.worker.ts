import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, canEncodeVideo } from "mediabunny";
import { CLIP_STYLE, createScene, drawGlow, drawOverlays, drawRiders, drawTrails } from "./renderer";
import { VIDEO_FPS, videoFrameCount, videoFrameTiming } from "./timing";
import type { RenderRequest, RenderMessage } from "./export-types";

const post = (message: RenderMessage, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

function context(canvas: OffscreenCanvas) {
  const result = canvas.getContext("2d");
  if (!result) throw new Error("Your browser could not prepare the video canvas.");
  return result;
}

async function render({ tracks, clipMs, theme, width, height, background, view, frame }: RenderRequest) {
  const quality = new Quality({ bitrate: 8_000_000 });
  if (!(await canEncodeVideo("avc", { width, height, quality }))) {
    throw new Error("This browser cannot create MP4 videos. Open the app in an up-to-date Chrome or Edge browser and try again.");
  }
  const scene = createScene(tracks, clipMs);
  const frames = videoFrameCount(clipMs);
  const clip = (ctx: OffscreenCanvasRenderingContext2D) => {
    ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.width, frame.height); ctx.clip();
  };
  const surface = new OffscreenCanvas(width, height);
  const ctx = context(surface);
  const glow = new OffscreenCanvas(width, height);
  const glowCtx = context(glow);
  const trails = new OffscreenCanvas(width, height);
  const trailCtx = context(trails);
  clip(trailCtx);
  let trailElapsedMs = 0;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(surface, { codec: "avc", quality, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  await output.start();
  for (let index = 0; index < frames; index++) {
    const { elapsedMs, timestamp, duration } = videoFrameTiming(index, clipMs);
    ctx.drawImage(background, 0, 0);
    ctx.save();
    clip(ctx);
    drawTrails(trailCtx, scene, trailElapsedMs, elapsedMs, view);
    trailElapsedMs = elapsedMs;
    // Glow below the lines, dots above them, as in the map preview.
    glowCtx.clearRect(0, 0, width, height);
    drawGlow(glowCtx, scene, elapsedMs, theme, view);
    ctx.save();
    ctx.filter = `blur(${CLIP_STYLE.glowBlur * view.scale}px)`; ctx.shadowColor = "white"; ctx.shadowBlur = CLIP_STYLE.glowShadow * view.scale;
    ctx.drawImage(glow, 0, 0);
    ctx.restore();
    ctx.drawImage(trails, 0, 0);
    drawRiders(ctx, scene, elapsedMs, view);
    ctx.restore();
    drawOverlays(ctx, scene, elapsedMs, width, height, true);
    await source.add(timestamp, duration);
    post({ type: "progress", fraction: (index + 1) / frames * 0.98, message: `Rendering video… ${Math.round((index + 1) / frames * 100)}%` });
  }
  post({ type: "progress", fraction: 0.99, message: "Finishing your MP4…" });
  source.close();
  await output.finalize();
  if (!output.target.buffer) throw new Error("The video could not be saved. Please try again.");
  return output.target.buffer;
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  try {
    const buffer = await render(event.data);
    post({ type: "done", buffer }, [buffer]);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "The video could not be created. Please try again." });
  }
};
