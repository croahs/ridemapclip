import { useState, type CSSProperties } from "react";
import { currentTrackElapsedSeconds } from "@/lib/clip/timing";
import { formatClipTime, formatDigitalTime } from "@/lib/format";
import type { Track } from "@/lib/track";
import type { PlaybackState } from "./use-clip-preview";
import styles from "./app.module.css";

type Props = {
  tracks: Track[]; colors: string[]; durations: number[]; clipSeconds: number; status: PlaybackState; elapsed: number;
  rendering: boolean; fullscreen: boolean;
  onPlay: () => void; onPause: () => void; onRestart: () => void; onFullscreen: () => void;
};

/** Playback buttons, clip progress and each rider's live moving time. */
export default function PlaybackPanel({ tracks, colors, durations, clipSeconds, status, elapsed, rendering, fullscreen, onPlay, onPause, onRestart, onFullscreen }: Props) {
  const [showRiderList, setShowRiderList] = useState(false);
  const clipMs = clipSeconds * 1000;
  const hasHourRides = tracks.some(track => (track.movingSeconds ?? 0) >= 3600);
  const finishedCount = durations.filter(duration => duration > 0 && elapsed >= duration).length;
  const activeCount = tracks.length - finishedCount;
  return (
    <div className={styles.playbackPanel}>
      <div className={styles.playbackHeading}><h3>Track animation</h3><span>{clipSeconds}-second clip</span></div>
      <div className={styles.playbackControls}>
        <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => {
          if (status === "playing") onPause();
          else onPlay();
        }}>{status === "playing" ? "Pause" : status === "paused" ? "Resume" : status === "finished" ? "Replay" : "Play animation"}</button>
        {(status === "playing" || status === "paused") && <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={() => onRestart()}>Restart</button>}
        <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={onFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
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
            const color = colors[index];
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
  );
}
