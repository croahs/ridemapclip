import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mapSegments, type Track } from "@/lib/track";
import { CLIP_DURATION_MS, CLIP_DURATION_SECONDS, ClipClock } from "@/lib/clip";
import { createPlaybackRoute, playbackFrame } from "@/lib/playback";
import { getTrackColor } from "@/lib/track-colors";
import { trackDurationsMs, trackProgress, currentTrackElapsedSeconds } from "@/lib/clip-timing";
import { formatDigitalTime, formatRideElapsed } from "@/lib/format";
import styles from "./app.module.css";

import VideoExport from "./video-export";
import { riderAppearance, VIDEO_FPS } from "@/lib/video-timing";
import { glowOpacityMultiplier, mapTileFilter, type MapTheme } from "@/lib/map-theme";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/video-format";
import { chronologicalTrailSlices } from "@/lib/trail-order";

type PlaybackState = "ready" | "playing" | "paused" | "finished";
type Controls = { play: () => void; pause: () => void; replay: () => void };

export default function TrackMap({ tracks }: { tracks: Track[] }) {
  const [rendering, setRendering] = useState(false);
  const [mapTheme, setMapTheme] = useState<MapTheme>("dark");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("landscape");
  const mapThemeRef = useRef(mapTheme);
  const player = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [showRiderList, setShowRiderList] = useState(false);
  const durations = useMemo(() => trackDurationsMs(tracks), [tracks]);
  const hasHourRides = useMemo(() => tracks.some((t) => (t.movingSeconds ?? 0) >= 3600), [tracks]);
  const longestElapsedSeconds = useMemo(() => {
    return tracks.reduce((max, track) => {
      return track.movingSeconds && Number.isFinite(track.movingSeconds) && track.movingSeconds > 0
        ? Math.max(max, track.movingSeconds)
        : max;
    }, 0);
  }, [tracks]);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const controls = useRef<Controls | null>(null);
  const [tileError, setTileError] = useState(false);
  const [status, setStatus] = useState<PlaybackState>("ready");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    mapThemeRef.current = mapTheme;
    const tileContainer = tilesRef.current?.getContainer();
    if (tileContainer) tileContainer.style.setProperty("--map-tile-filter", mapTileFilter(mapTheme));
  }, [mapTheme]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize();
      if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [35, 35], maxZoom: 16 });
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
    // Keep every rider above all route lines and trails, regardless of upload order.
    map.createPane("riders").style.zIndex = "625";
    map.createPane("riderTrails").style.zIndex = "350";
    const chronologicalTrails = map.createPane("chronologicalTrails");
    chronologicalTrails.style.zIndex = "400";
    const trailCanvas = document.createElement("canvas");
    trailCanvas.style.position = "absolute";
    trailCanvas.style.pointerEvents = "none";
    chronologicalTrails.appendChild(trailCanvas);
    const preparedTrailContext = trailCanvas.getContext("2d");
    if (!preparedTrailContext) throw new Error("Your browser could not prepare the route preview.");
    const trailContext: CanvasRenderingContext2D = preparedTrailContext;
    const glowRenderer = L.svg({ pane: "riderTrails" });
    // White glow sits below route lines (400); rider dots stay above them (625).
    const riderRenderer = L.svg({ pane: "riders" });
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
    const bounds = L.latLngBounds([]);
    const isLargePack = tracks.length > 20;
    const trailWeight = isLargePack ? 1.125 : 1.875;
    const riderRadius = isLargePack ? 2.5 : 4;
    const riderWeight = isLargePack ? 1 : 1.5;

    const layers = tracks.map((track, index) => {
      const color = getTrackColor(index, tracks.length);
      const segments = mapSegments(track.points);
      const route = createPlaybackRoute(track.points);
      const glowTails = [
        { length: 64, weight: 10, opacity: 0.2 },
        { length: 44, weight: 8, opacity: 0.35 },
        { length: 26, weight: 6, opacity: 0.6 },
        { length: 12, weight: 3, opacity: 0.95 },
      ].map(({ length, weight, opacity }) => {
        const line = L.polyline([], {
          pane: "riderTrails", renderer: glowRenderer, className: styles.riderGlowTrail,
          color: "#fff", weight: weight * 0.5 * (isLargePack ? 0.75 : 1), opacity,
          lineCap: "round", lineJoin: "round", interactive: false,
        }).addTo(map);
        return { line, length };
      });
      const start = route.coordinates[0];
      const rider = L.circleMarker(start, { pane: "riders", renderer: riderRenderer, radius: riderRadius, color: "#fff", weight: riderWeight, fillColor: color, fillOpacity: 1, interactive: true })
        .addTo(map).bindTooltip(`${index + 1}. ${track.name}`, { direction: "top", offset: [0, -6] });
      for (const segment of segments) bounds.extend(segment);
      return { route, color, trackIndex: index, rider, glowTails, durationMs: durations[index] };
    });
    boundsRef.current = bounds;
    map.fitBounds(boundsRef.current, { padding: [35, 35], maxZoom: 16 });
    // fitBounds initializes the view and creates the tile container.
    const tileContainer = tiles.getContainer();
    if (tileContainer) tileContainer.style.setProperty("--map-tile-filter", mapTileFilter(mapThemeRef.current));
    L.control.scale({ imperial: false }).addTo(map);
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container.current);

    const trailFrameMs = 1000 / VIDEO_FPS;
    let trailElapsedMs = 0;

    function prepareTrailCanvas() {
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      trailCanvas.width = Math.max(1, Math.round(size.x * ratio));
      trailCanvas.height = Math.max(1, Math.round(size.y * ratio));
      trailCanvas.style.width = `${size.x}px`;
      trailCanvas.style.height = `${size.y}px`;
      L.DomUtil.setPosition(trailCanvas, map.containerPointToLayerPoint([0, 0]));
      trailContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      trailContext.lineCap = "round";
      trailContext.lineJoin = "round";
      trailContext.lineWidth = trailWeight;
    }

    function drawTrailInterval(fromMs: number, toMs: number) {
      const slices = chronologicalTrailSlices(layers, fromMs, toMs);
      for (const { color, sections } of slices) {
        trailContext.beginPath();
        for (const section of sections) {
          const start = map.latLngToContainerPoint(section[0]);
          trailContext.moveTo(start.x, start.y);
          for (let index = 1; index < section.length; index++) {
            const point = map.latLngToContainerPoint(section[index]);
            trailContext.lineTo(point.x, point.y);
          }
        }
        trailContext.strokeStyle = color;
        trailContext.stroke();
      }
    }

    function rebuildTrails() {
      const targetMs = trailElapsedMs;
      prepareTrailCanvas();
      trailElapsedMs = 0;
      while (trailElapsedMs < targetMs) {
        const nextMs = Math.min(targetMs, trailElapsedMs + trailFrameMs);
        drawTrailInterval(trailElapsedMs, nextMs);
        trailElapsedMs = nextMs;
      }
    }

    function advanceTrails(milliseconds: number) {
      while (trailElapsedMs + trailFrameMs <= milliseconds) {
        const nextMs = trailElapsedMs + trailFrameMs;
        drawTrailInterval(trailElapsedMs, nextMs);
        trailElapsedMs = nextMs;
      }
      if (milliseconds === CLIP_DURATION_MS && trailElapsedMs < milliseconds) {
        drawTrailInterval(trailElapsedMs, milliseconds);
        trailElapsedMs = milliseconds;
      }
    }

    function clearTrails() {
      prepareTrailCanvas();
      trailElapsedMs = 0;
    }

    prepareTrailCanvas();
    map.on("moveend zoomend resize", rebuildTrails);

    const clock = new ClipClock();
    let frameId: number | null = null;
    let running = false;
    let lastUiUpdate = -Infinity;

    function paint(milliseconds: number) {
      advanceTrails(milliseconds);
      for (const { route, rider, glowTails, durationMs } of layers) {
        const frame = playbackFrame(route, trackProgress(milliseconds, durationMs));
        rider.setLatLng(frame.position);
        const appearance = riderAppearance(milliseconds, durationMs);
        const finished = !appearance.visible;
        if (finished && map.hasLayer(rider)) {
          rider.closeTooltip();
          rider.remove();
        } else if (!finished && !map.hasLayer(rider)) {
          rider.addTo(map);
        }
        // Keep the glow fade inside the fixed 30-second clip.
        for (const { line } of glowTails) {
          line.getElement()?.setAttribute("opacity", String(appearance.glowOpacity * glowOpacityMultiplier(mapThemeRef.current)));
        }
        // Follow only the current continuous GPS section, with a screen-sized tail.
        const section = frame.sections[frame.sections.length - 1];
        for (const { line, length } of glowTails) {
          const tail: L.LatLngTuple[] = [frame.position];
          let remaining = length;
          let tip = map.latLngToLayerPoint(frame.position);
          for (let i = section.length - 1; i >= 0 && remaining > 0; i--) {
            const point = map.latLngToLayerPoint(section[i]);
            const distance = tip.distanceTo(point);
            if (distance > remaining) {
              const end = tip.add(point.subtract(tip).multiplyBy(remaining / distance));
              const latLng = map.layerPointToLatLng(end);
              tail.push([latLng.lat, latLng.lng]);
              break;
            }
            tail.push(section[i]);
            remaining -= distance;
            tip = point;
          }
          line.setLatLngs(tail);
        }
      }
    }

    function tick(now: number) {
      if (!running) return;
      const milliseconds = clock.elapsed(now);
      paint(milliseconds);
      if (now - lastUiUpdate >= 100 || milliseconds === CLIP_DURATION_MS) {
        setElapsed(milliseconds);
        lastUiUpdate = now;
      }
      if (milliseconds >= CLIP_DURATION_MS) {
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
      setStatus(milliseconds === CLIP_DURATION_MS ? "finished" : "paused");
    }

    function play() {
      if (running) return;
      const now = performance.now();
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
    };
    // Hidden tabs stop requesting frames. Pause explicitly rather than skipping
    // ahead when the user returns to their 30-second preview.
    const onVisibility = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      if (frameId !== null) cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibility);
      map.off("moveend zoomend resize", rebuildTrails);
      controls.current = null;
      observer.disconnect();
      tiles.off();
      tilesRef.current = null;
      map.remove();
      mapRef.current = null;
      boundsRef.current = null;
    };
  }, [tracks, durations]);

  return (
    <div
      ref={player}
      className={`${styles.player} ${rendering ? styles.rendering : ""} ${fullscreen && !controlsVisible ? styles.cursorHidden : ""}`}
      onMouseMove={onUserActivity}
      onMouseEnter={onUserActivity}
      onClick={onUserActivity}
    >
      <VideoExport tracks={tracks} mapTheme={mapTheme} videoFormat={videoFormat} getMap={() => mapRef.current} pausePreview={() => controls.current?.pause()} onBusy={setRendering} />
      <div className={styles.playbackPanel}>
        <div className={styles.playbackHeading}><h3>Track animation</h3><span>{CLIP_DURATION_SECONDS}-second clip</span></div>
        <div className={styles.playbackControls}>
          <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => {
            if (status === "playing") controls.current?.pause();
            else controls.current?.play();
          }}>{status === "playing" ? "Pause" : status === "paused" ? "Resume" : status === "finished" ? "Replay" : "Play animation"}</button>
          {(status === "playing" || status === "paused") && <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => controls.current?.replay()}>Restart</button>}
          <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
          <span className={styles.playbackTime} aria-label="Playback time">0:{String(Math.floor(elapsed / 1000)).padStart(2, "0")} / 0:{CLIP_DURATION_SECONDS}</span>
        </div>
        <progress className={styles.playbackProgress} value={elapsed} max={CLIP_DURATION_MS} aria-label="Clip progress" />
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
        <p className={styles.hint} role="status">{status === "finished" ? "Animation complete." : status === "paused" ? "Paused. Resume to continue from here." : status === "playing" ? "Playing your 30-second route preview." : "The longest moving time becomes 30 seconds. Shorter rides finish proportionally earlier."}</p>
      </div>
      {fullscreenError && <p className={styles.error} role="alert">{fullscreenError}</p>}
      {tracks.some((track) => !track.movingSeconds || track.movingSeconds <= 0) && <p className={styles.hint}>Rides without a moving time use the full 30 seconds.</p>}
      <div className={styles.mapToolbar}>
        <div className={styles.mapOptions}>
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
          if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [35, 35], maxZoom: 16 });
        }}>Center on tracks</button>
      </div>
      <div className={styles.mapWrapper} data-format={videoFormat} style={{ "--map-aspect-ratio": VIDEO_FORMATS[videoFormat].aspectRatio } as CSSProperties}>
        <div ref={container} className={styles.map} role="region" aria-label={`Interactive map of ${tracks.length} tracks`} />
        <div className={styles.mapOverlayTopLeft}>
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
          <div className={styles.overlayTimeBadge} aria-label="Ride moving time">
            {formatRideElapsed(
              longestElapsedSeconds > 0
                ? Math.min(1, Math.max(0, elapsed / CLIP_DURATION_MS)) * longestElapsedSeconds
                : null,
              hasHourRides
            )}
          </div>
          <div className={styles.mapWatermark} aria-label="ridemapclip watermark">ridemapclip.vercel.app</div>
        </div>
      </div>
      {tileError && <p className={styles.hint} role="status">Some map tiles could not load. Your track is still available; check your internet connection to see the background map.</p>}
      <p className={styles.hint}>Drag to explore. Use + and − to zoom. Playback pauses when you leave this tab. Background maps need an internet connection.</p>
    </div>
  );
}
