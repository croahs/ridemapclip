import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ClipClock, currentTrackElapsedSeconds, trackDurationsMs, videoFrameCount } from "@/lib/clip";
import { CLIP_STYLE, createScene, drawGlow, drawOverlays, drawRiders, drawTrails, type ClipView, type Point } from "@/lib/clip-renderer";
import { getTrackColor } from "@/lib/track-colors";
import { formatClipTime, formatDigitalTime } from "@/lib/format";
import { mapTileFilter, type MapTheme } from "@/lib/map-theme";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/video-format";
import type { Track } from "@/lib/track";
import VideoExport from "./video-export";
import ClipLength from "./clip-length";
import styles from "./app.module.css";

type PlaybackState = "ready" | "playing" | "paused" | "finished";
type Controls = { play: () => void; pause: () => void; replay: () => void; repaint: () => void; setClipMs: (clipMs: number) => void };

export default function TrackMap({ tracks, clipSeconds, onClipSecondsChange }: { tracks: Track[]; clipSeconds: number; onClipSecondsChange: (seconds: number) => void }) {
  const clipMs = clipSeconds * 1000;
  const clipMsRef = useRef(clipMs);
  const [rendering, setRendering] = useState(false);
  const [mapTheme, setMapTheme] = useState<MapTheme>("dark");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("landscape");
  const mapThemeRef = useRef(mapTheme);
  const player = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [showRiderList, setShowRiderList] = useState(false);
  const durations = useMemo(() => trackDurationsMs(tracks, clipMs), [tracks, clipMs]);
  const hasHourRides = useMemo(() => tracks.some((t) => (t.movingSeconds ?? 0) >= 3600), [tracks]);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const controls = useRef<Controls | null>(null);
  const [tileError, setTileError] = useState(false);
  const [status, setStatus] = useState<PlaybackState>("ready");
  const [elapsed, setElapsed] = useState(0);

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

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
      if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [CLIP_STYLE.fitPadding, CLIP_STYLE.fitPadding], maxZoom: 16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [videoFormat]);

  const finishedCount = useMemo(() => durations.filter((d) => d > 0 && elapsed >= d).length, [durations, elapsed]);
  const activeCount = tracks.length - finishedCount;

  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onUserActivity = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (document.fullscreenElement === player.current) {
      hideTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  };

  useEffect(() => {
    const changed = () => {
      const isFs = document.fullscreenElement === player.current;
      setFullscreen(isFs);
      setControlsVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (isFs) {
        hideTimer.current = setTimeout(() => {
          setControlsVisible(false);
        }, 2500);
      }
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 60);
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (document.fullscreenElement === player.current) await document.exitFullscreen();
      else if (player.current?.requestFullscreen) await player.current.requestFullscreen();
      else setFullscreenError("Fullscreen is not available in this browser. Open the app in Chrome or Edge to use fullscreen.");
    } catch {
      setFullscreenError("Fullscreen could not open. Try opening the app in a separate browser window.");
    }
  }

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
    for (const { route } of scene.riders) bounds.extend(L.latLngBounds(route.coordinates));
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

  return (
    <div
      ref={player}
      className={`${styles.player} ${rendering ? styles.rendering : ""} ${fullscreen && !controlsVisible ? styles.cursorHidden : ""}`}
      onMouseMove={onUserActivity}
      onMouseEnter={onUserActivity}
      onClick={onUserActivity}
    >
      <VideoExport tracks={tracks} clipMs={clipMs} mapTheme={mapTheme} videoFormat={videoFormat} getMap={() => mapRef.current} pausePreview={() => controls.current?.pause()} onBusy={setRendering} />
      <div className={styles.playbackPanel}>
        <div className={styles.playbackHeading}><h3>Track animation</h3><span>{clipSeconds}-second clip</span></div>
        <div className={styles.playbackControls}>
          <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => {
            if (status === "playing") controls.current?.pause();
            else controls.current?.play();
          }}>{status === "playing" ? "Pause" : status === "paused" ? "Resume" : status === "finished" ? "Replay" : "Play animation"}</button>
          {(status === "playing" || status === "paused") && <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => controls.current?.replay()}>Restart</button>}
          <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
          <span className={styles.playbackTime} aria-label="Playback time">{formatClipTime(elapsed / 1000)} / {formatClipTime(clipSeconds)}</span>
        </div>
        <progress className={styles.playbackProgress} value={elapsed} max={clipMs} aria-label="Clip progress" />
        {tracks.length > 5 ? (
          <div className={styles.packTelemetryBar}>
            <div className={styles.packTelemetryStats}>
              <span className={styles.packTelemetryItem}><strong>{tracks.length}</strong> Total riders</span>
              <span className={styles.packTelemetryItem}><strong>{activeCount}</strong> On course</span>
              <span className={styles.packTelemetryItem}><strong>{finishedCount}</strong> Finished</span>
            </div>
            <button
              type="button"
              className={styles.secondaryButton} disabled={rendering}
              style={{ padding: "4px 10px", fontSize: "0.8rem" }}
              onClick={() => setShowRiderList(!showRiderList)}
            >
              {showRiderList ? "Hide rider roster" : `Show roster (${tracks.length})`}
            </button>
          </div>
        ) : null}
        {(tracks.length <= 5 || showRiderList) && (
          <div className={`${styles.telemetryGrid} ${tracks.length > 5 ? styles.telemetryGridScrollable : ""}`} aria-label="Rider live moving times">
            {tracks.map((track, index) => {
              const currentSec = currentTrackElapsedSeconds(elapsed, durations[index], track.movingSeconds);
              const isFinished = durations[index] > 0 && elapsed >= durations[index];
              const color = getTrackColor(index, tracks.length);
              return (
                <div
                  key={`${track.name}-${index}`}
                  className={`${styles.telemetryCard} ${isFinished ? styles.telemetryCardFinished : ""}`}
                  style={{ "--track-color": color } as CSSProperties}
                >
                  <div className={styles.telemetryHeader}>
                    <span className={styles.telemetryDot} style={{ backgroundColor: color }} />
                    <span className={styles.telemetryName} title={track.name}>
                      {index + 1}. {track.name}
                    </span>
                    {isFinished && <span className={styles.telemetryBadge}>Finished</span>}
                  </div>
                  <div className={styles.telemetryTime}>
                    {track.movingSeconds !== null ? (
                      <>
                        <span className={styles.telemetryCurrent}>
                          {formatDigitalTime(currentSec, hasHourRides)}
                        </span>
                        <span className={styles.telemetryTotal}>
                          {" "}/ {formatDigitalTime(track.movingSeconds, hasHourRides)}
                        </span>
                      </>
                    ) : (
                      <span className={styles.telemetryMissing}>Moving time unavailable</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className={styles.hint} role="status">{status === "finished" ? "Animation complete." : status === "paused" ? "Paused. Resume to continue from here." : status === "playing" ? `Playing your ${clipSeconds}-second route preview.` : `The longest moving time becomes ${clipSeconds} seconds. Shorter rides finish proportionally earlier.`}</p>
      </div>
      {fullscreenError && <p className={styles.error} role="alert">{fullscreenError}</p>}
      {tracks.some((track) => !track.movingSeconds || track.movingSeconds <= 0) && <p className={styles.hint}>Rides without a moving time use the full clip length.</p>}
      <div className={styles.mapToolbar}>
        <div className={styles.mapOptions}>
          <ClipLength seconds={clipSeconds} disabled={rendering} onChange={onClipSecondsChange} />
          <div className={styles.themeControl} role="group" aria-label="Map theme">
            <span>Map</span>
            {(["dark", "light"] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`${styles.secondaryButton} ${mapTheme === theme ? styles.themeButtonActive : ""}`}
                disabled={rendering}
                aria-pressed={mapTheme === theme}
                onClick={() => setMapTheme(theme)}
              >
                {theme === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
          <div className={styles.themeControl} role="group" aria-label="Video format">
            <span>Format</span>
            {(Object.keys(VIDEO_FORMATS) as VideoFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              className={`${styles.secondaryButton} ${videoFormat === format ? styles.themeButtonActive : ""}`}
              disabled={rendering}
              aria-pressed={videoFormat === format}
              onClick={() => setVideoFormat(format)}
            >
              {VIDEO_FORMATS[format].label}
            </button>
          ))}
        </div>
        </div>
        <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => {
          if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [CLIP_STYLE.fitPadding, CLIP_STYLE.fitPadding], maxZoom: 16 });
        }}>Center on tracks</button>
      </div>
      <div className={styles.mapWrapper} data-format={videoFormat} style={{ "--map-aspect-ratio": VIDEO_FORMATS[videoFormat].aspectRatio } as CSSProperties}>
        <div ref={container} className={styles.map} role="region" aria-label={`Interactive map of ${tracks.length} tracks`} />
        <div className={styles.mapOverlayControls}>
          {fullscreen && (
            <div
              className={`${styles.fullscreenControls} ${!controlsVisible ? styles.fullscreenControlsHidden : ""}`}
              aria-label="Fullscreen video playback controls"
            >
              <button
                type="button"
                className={`${styles.overlayIconButton} ${status === "playing" ? styles.overlayIconButtonActive : ""}`}
                aria-label="Play animation"
                title="Play"
                onClick={(e) => { e.stopPropagation(); controls.current?.play(); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.overlayIconButton} ${status === "paused" ? styles.overlayIconButtonActive : ""}`}
                aria-label="Pause animation"
                title="Pause"
                onClick={(e) => { e.stopPropagation(); controls.current?.pause(); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                className={styles.overlayIconButton}
                aria-label="Exit fullscreen"
                title="Exit fullscreen"
                onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {tileError && <p className={styles.hint} role="status">Some map tiles could not load. Your track is still available; check your internet connection to see the background map.</p>}
      <p className={styles.hint}>Drag to explore. Use + and − to zoom. Playback pauses when you leave this tab. Background maps need an internet connection.</p>
    </div>
  );
}
