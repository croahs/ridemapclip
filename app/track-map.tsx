import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { trackDurationsMs } from "@/lib/clip/timing";
import type { MapTheme } from "@/lib/clip/map-theme";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/clip/video-format";
import type { Track } from "@/lib/track";
import VideoExport from "./video-export";
import PlaybackPanel from "./playback-panel";
import MapToolbar from "./map-toolbar";
import { useClipPreview } from "./use-clip-preview";
import styles from "./app.module.css";

export default function TrackMap({ tracks, clipSeconds, onClipSecondsChange }: { tracks: Track[]; clipSeconds: number; onClipSecondsChange: (seconds: number) => void }) {
  const clipMs = clipSeconds * 1000;
  const [rendering, setRendering] = useState(false);
  const [mapTheme, setMapTheme] = useState<MapTheme>("dark");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("landscape");
  const player = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const durations = useMemo(() => trackDurationsMs(tracks, clipMs), [tracks, clipMs]);
  const { container, mapRef, controls, status, elapsed, tileError, recenter } = useClipPreview({ tracks, clipMs, mapTheme, videoFormat });

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
  }, [mapRef]);

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

  return (
    <div
      ref={player}
      className={`${styles.player} ${rendering ? styles.rendering : ""} ${fullscreen && !controlsVisible ? styles.cursorHidden : ""}`}
      onMouseMove={onUserActivity}
      onMouseEnter={onUserActivity}
      onClick={onUserActivity}
    >
      <VideoExport tracks={tracks} clipMs={clipMs} mapTheme={mapTheme} videoFormat={videoFormat} getMap={() => mapRef.current} pausePreview={() => controls.current?.pause()} onBusy={setRendering} />
      <PlaybackPanel tracks={tracks} durations={durations} clipSeconds={clipSeconds} status={status} elapsed={elapsed} rendering={rendering} fullscreen={fullscreen}
        onPlay={() => controls.current?.play()} onPause={() => controls.current?.pause()} onRestart={() => controls.current?.replay()} onFullscreen={toggleFullscreen} />
      {fullscreenError && <p className={styles.error} role="alert">{fullscreenError}</p>}
      {tracks.some((track) => !track.movingSeconds || track.movingSeconds <= 0) && <p className={styles.hint}>Rides without a moving time use the full clip length.</p>}
      <MapToolbar clipSeconds={clipSeconds} onClipSecondsChange={onClipSecondsChange} mapTheme={mapTheme} onMapTheme={setMapTheme}
        videoFormat={videoFormat} onVideoFormat={setVideoFormat} rendering={rendering} onRecenter={recenter} />
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
