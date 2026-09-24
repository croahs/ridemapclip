import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ClipClock, videoFrameCount } from "@/lib/clip/timing";
import { CLIP_STYLE, createScene, drawGlow, drawOverlays, drawRiders, drawTrails, type ClipView, type Point } from "@/lib/clip/renderer";
import { mapTileFilter, type MapTheme } from "@/lib/clip/map-theme";
import type { VideoFormat } from "@/lib/clip/video-format";
import type { Track } from "@/lib/track";
import styles from "./app.module.css";

export type PlaybackState = "ready" | "playing" | "paused" | "finished";
export type PreviewControls = { play: () => void; pause: () => void; replay: () => void; repaint: () => void; setClipMs: (clipMs: number) => void };

/**
 * The Leaflet map plus the canvas layers and playback clock of the clip preview.
 * Drawing goes through lib/clip/renderer, exactly like the video export.
 */
export function useClipPreview({ tracks, clipMs, mapTheme, videoFormat }: { tracks: Track[]; clipMs: number; mapTheme: MapTheme; videoFormat: VideoFormat }) {
  const clipMsRef = useRef(clipMs);
  const mapThemeRef = useRef(mapTheme);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const controls = useRef<PreviewControls | null>(null);
  const [tileError, setTileError] = useState(false);
  const [status, setStatus] = useState<PlaybackState>("ready");
  const [elapsed, setElapsed] = useState(0);

  const recenter = () => {
    if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [CLIP_STYLE.fitPadding, CLIP_STYLE.fitPadding], maxZoom: 16 });
  };

  useEffect(() => {
    clipMsRef.current = clipMs;
    controls.current?.setClipMs(clipMs);
  }, [clipMs]);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
    const tileContainer = tilesRef.current?.getContainer();
    if (tileContainer) tileContainer.style.setProperty("--map-tile-filter", mapTileFilter(mapTheme));
    controls.current?.repaint();
  }, [mapTheme]);

  // The map box follows the video format; refit the tracks when it changes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
      if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [CLIP_STYLE.fitPadding, CLIP_STYLE.fitPadding], maxZoom: 16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [videoFormat]);

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { scrollWheelZoom: false, zoomControl: false, preferCanvas: true });
    mapRef.current = map;
    L.control.zoom({ position: "topright" }).addTo(map);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: "anonymous",
      className: styles.mapTile,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    tilesRef.current = tiles;
    tiles.on("tileerror", () => setTileError(true));

    // The preview draws with the same functions as the video export (lib/clip-renderer).
    let scene = createScene(tracks, clipMsRef.current);
    const layer = (pane: string, zIndex: number, className: string) => {
      const element = map.createPane(pane);
      element.style.zIndex = String(zIndex);
      const canvas = document.createElement("canvas");
      canvas.className = className;
      element.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser could not prepare the route preview.");
      return { canvas, ctx };
    };
    // Glow sits below the route lines; rider dots stay above them.
    const glow = layer("clipGlow", 350, `leaflet-zoom-hide ${styles.clipLayer} ${styles.riderGlowTrail}`);
    const trails = layer("clipTrails", 400, `leaflet-zoom-hide ${styles.clipLayer}`);
    const riders = layer("clipRiders", 625, `leaflet-zoom-hide ${styles.clipLayer}`);
    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.className = styles.clipOverlay;
    map.getContainer().appendChild(overlayCanvas);
    const overlayCtx = overlayCanvas.getContext("2d");
    if (!overlayCtx) throw new Error("Your browser could not prepare the route preview.");
    const overlay = { canvas: overlayCanvas, ctx: overlayCtx };

    const bounds = L.latLngBounds([]);
    for (const { route } of scene.riders) {
      for (let i = 0; i < route.latitudes.length; i++) bounds.extend([route.latitudes[i], route.longitudes[i]]);
    }
    boundsRef.current = bounds;
    map.fitBounds(bounds, { padding: [CLIP_STYLE.fitPadding, CLIP_STYLE.fitPadding], maxZoom: 16 });
    // fitBounds initializes the view and creates the tile container.
    const tileContainer = tiles.getContainer();
    if (tileContainer) tileContainer.style.setProperty("--map-tile-filter", mapTileFilter(mapThemeRef.current));
    L.control.scale({ imperial: false }).addTo(map);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);

    // Canvases sit at the layer position of the map's top-left corner and move with the map pane while dragging.
    let origin = L.point(0, 0);
    let size = L.point(1, 1);
    let view: ClipView = { zoom: 0, scale: 1, dx: 0, dy: 0 };
    function prepare() {
      size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      origin = map.containerPointToLayerPoint([0, 0]);
      const pixelOrigin = map.getPixelOrigin();
      view = { zoom: map.getZoom(), scale: 1, dx: -pixelOrigin.x - origin.x, dy: -pixelOrigin.y - origin.y };
      for (const { canvas, ctx } of [glow, trails, riders, overlay]) {
        canvas.width = Math.max(1, Math.round(size.x * ratio));
        canvas.height = Math.max(1, Math.round(size.y * ratio));
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      for (const { canvas } of [glow, trails, riders]) L.DomUtil.setPosition(canvas, origin);
    }

    // Trails are drawn in the same steps as video frames, so overlaps stack identically.
    let trailStepMs = scene.clipMs / (videoFrameCount(scene.clipMs) - 1);
    let trailElapsedMs = 0;
    function advanceTrails(milliseconds: number) {
      while (trailElapsedMs + trailStepMs <= milliseconds) {
        drawTrails(trails.ctx, scene, trailElapsedMs, trailElapsedMs + trailStepMs, view);
        trailElapsedMs += trailStepMs;
      }
      if (milliseconds >= scene.clipMs && trailElapsedMs < scene.clipMs) {
        drawTrails(trails.ctx, scene, trailElapsedMs, scene.clipMs, view);
        trailElapsedMs = scene.clipMs;
      }
    }
    function clearTrails() {
      trails.ctx.clearRect(0, 0, size.x, size.y);
      trailElapsedMs = 0;
    }

    let clock = new ClipClock(scene.clipMs);
    let frameId: number | null = null;
    let running = false;
    let lastUiUpdate = -Infinity;
    let positions: (Point | null)[] = [];

    function paint(milliseconds: number) {
      advanceTrails(milliseconds);
      glow.ctx.clearRect(0, 0, size.x, size.y);
      drawGlow(glow.ctx, scene, milliseconds, mapThemeRef.current, view);
      riders.ctx.clearRect(0, 0, size.x, size.y);
      positions = drawRiders(riders.ctx, scene, milliseconds, view);
      overlay.ctx.clearRect(0, 0, size.x, size.y);
      drawOverlays(overlay.ctx, scene, milliseconds, size.x, size.y, false);
    }

    function redraw() {
      prepare();
      const milliseconds = clock.elapsed(performance.now());
      trailElapsedMs = 0;
      paint(milliseconds);
    }
    prepare();
    paint(0);
    map.on("moveend zoomend resize", redraw);

    // Rider names on hover; dots are drawn on canvas, so hit-test their last positions.
    const tooltip = L.tooltip({ direction: "top", offset: [0, -6] });
    const hoverRadius = (scene.large ? CLIP_STYLE.riderRadius.large : CLIP_STYLE.riderRadius.normal) + 6;
    map.on("mousemove", event => {
      const x = event.layerPoint.x - origin.x;
      const y = event.layerPoint.y - origin.y;
      let nearest = -1;
      let best = hoverRadius;
      positions.forEach((position, index) => {
        const distance = position ? Math.hypot(position[0] - x, position[1] - y) : Infinity;
        if (distance <= best) { best = distance; nearest = index; }
      });
      if (nearest < 0) { map.closeTooltip(tooltip); return; }
      tooltip.setLatLng(event.latlng).setContent(`${nearest + 1}. ${tracks[nearest].name}`);
      map.openTooltip(tooltip);
    });
    map.on("mouseout", () => map.closeTooltip(tooltip));

    function tick(now: number) {
      if (!running) return;
      const milliseconds = clock.elapsed(now);
      paint(milliseconds);
      if (now - lastUiUpdate >= 100 || milliseconds === scene.clipMs) {
        setElapsed(milliseconds);
        lastUiUpdate = now;
      }
      if (milliseconds >= scene.clipMs) {
        clock.pause(now);
        running = false;
        frameId = null;
        setStatus("finished");
        return;
      }
      frameId = requestAnimationFrame(tick);
    }

    function pause() {
      if (!running) return;
      running = false;
      clock.pause(performance.now());
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      const milliseconds = clock.elapsed(performance.now());
      paint(milliseconds);
      setElapsed(milliseconds);
      setStatus(milliseconds === scene.clipMs ? "finished" : "paused");
    }

    function play() {
      if (running) return;
      const now = performance.now();
      // Replaying a finished clip starts from an empty map.
      if (clock.elapsed(now) >= scene.clipMs) clearTrails();
      clock.play(now);
      const milliseconds = clock.elapsed(now);
      paint(milliseconds);
      setElapsed(milliseconds);
      running = true;
      setStatus("playing");
      frameId = requestAnimationFrame(tick);
    }

    controls.current = {
      play, pause,
      replay: () => {
        pause();
        clock.reset();
        clearTrails();
        play();
      },
      repaint: () => paint(clock.elapsed(performance.now())),
      // A new clip length restarts playback from an empty map; the map view is kept.
      setClipMs: (next: number) => {
        if (next === scene.clipMs) return;
        pause();
        scene = createScene(tracks, next);
        trailStepMs = scene.clipMs / (videoFrameCount(scene.clipMs) - 1);
        clock = new ClipClock(scene.clipMs);
        clearTrails();
        paint(0);
        setElapsed(0);
        setStatus("ready");
      },
    };
    // Hidden tabs stop requesting frames. Pause explicitly rather than skipping
    // ahead when the user returns to their preview.
    const onVisibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      if (frameId !== null) cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibility);
      controls.current = null;
      observer.disconnect();
      tiles.off();
      tilesRef.current = null;
      map.remove();
      mapRef.current = null;
      boundsRef.current = null;
    };
  }, [tracks]);

  return { container, mapRef, controls, status, elapsed, tileError, recenter };
}
