"use client";

import { useEffect, useRef, useState } from "react";
import type L from "leaflet";
import type { Track } from "@/lib/track";
import type { VideoProgress } from "@/lib/render-video";
import type { MapTheme } from "@/lib/map-theme";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/video-format";
import styles from "./page.module.css";

export default function VideoExport({ tracks, mapTheme, videoFormat, getMap, pausePreview, onBusy }: {
  tracks: Track[]; mapTheme: MapTheme; videoFormat: VideoFormat; getMap: () => L.Map | null; pausePreview: () => void; onBusy: (busy: boolean) => void;
}) {
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [error, setError] = useState("");
  const [video, setVideo] = useState<string | null>(null);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (video) result.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [video]);
  const controller = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);
  useEffect(() => () => {
    controller.current?.abort();
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);

  async function createVideo() {
    if (controller.current) return;
    const map = getMap();
    if (!map) return;
    const task = new AbortController(); controller.current = task;
    setError(""); setProgress({ fraction: 0, message: "Preparing your video…" }); onBusy(true); pausePreview();
    const handlers = [map.dragging, map.scrollWheelZoom, map.doubleClickZoom, map.boxZoom, map.keyboard, map.touchZoom].filter(handler => handler.enabled());
    handlers.forEach(handler => handler.disable());
    try {
      const { renderVideo } = await import("@/lib/render-video");
      const blob = await renderVideo(map, tracks, mapTheme, videoFormat, task.signal, value => { if (!task.signal.aborted) setProgress(value); });
      if (task.signal.aborted) return;
      const next = URL.createObjectURL(blob);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = next; setVideo(next);
    } catch (failure) {
      if (!task.signal.aborted) setError(failure instanceof Error ? failure.message : "The video could not be created. Please try again.");
    } finally {
      handlers.forEach(handler => handler.enable());
      if (controller.current === task) { controller.current = null; setProgress(null); onBusy(false); }
    }
  }

  return <section className={styles.videoExport} aria-label="Create and download video">
    <h3>Your video</h3>
    {video && <div ref={result} className={styles.videoResult}>
      <p className={styles.success}>Your video is ready.</p>
      <video key={video} controls playsInline preload="metadata" src={video} className={styles.renderedVideo} aria-label="Rendered ride video" />
      <a className={styles.secondaryButton} href={video} download="ridemapclip.mp4">Download MP4</a>
      <p className={styles.hint}>This video uses the map position from when you clicked Create video. Reposition the map and create another video to change it.</p>
    </div>}
    <p className={styles.hint}>Position the map above, then create a smooth {VIDEO_FORMATS[videoFormat].label} 30-second video. 30 fps · MP4. Keep this tab open while it renders.</p>
    <button className={styles.primaryButton} type="button" disabled={progress !== null} onClick={createVideo}>{progress ? "Creating video…" : "Create video"}</button>
    {progress && <div>
      <p className={styles.hint} role="status">{progress.message}</p>
      <progress className={styles.playbackProgress} value={progress.fraction} max={1} aria-label="Video rendering progress" />
      <button type="button" className={styles.secondaryButton} onClick={() => controller.current?.abort()}>Cancel rendering</button>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}

  </section>;
}
