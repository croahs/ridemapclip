import { useState } from "react";
import { CLIP_SECONDS, clampClipSeconds } from "@/lib/clip/timing";
import type { MapTheme } from "@/lib/clip/map-theme";
import type { ColorMode } from "@/lib/clip/track-colors";
import { VIDEO_FORMATS, type VideoFormat } from "@/lib/clip/video-format";
import styles from "./app.module.css";

type Props = {
  clipSeconds: number; onClipSecondsChange: (seconds: number) => void;
  colorMode: ColorMode; onColorModeChange: (mode: ColorMode) => void;
  mapTheme: MapTheme; onMapTheme: (theme: MapTheme) => void;
  videoFormat: VideoFormat; onVideoFormat: (format: VideoFormat) => void;
  rendering: boolean; onRecenter: () => void;
};

/** Clip length, colour mode, map theme, video format and recentring. */
export default function MapToolbar({ clipSeconds, onClipSecondsChange, colorMode, onColorModeChange, mapTheme, onMapTheme, videoFormat, onVideoFormat, rendering, onRecenter }: Props) {
  return (
    <div className={styles.mapToolbar}>
      <div className={styles.mapOptions}>
        <ClipLength seconds={clipSeconds} disabled={rendering} onChange={onClipSecondsChange} />
        <div className={styles.themeControl} role="group" aria-label="Track colors">
          <span>Colors</span>
          {([["ride", "By ride"], ["date", "By date"]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`${styles.secondaryButton} ${colorMode === mode ? styles.themeButtonActive : ""}`}
              disabled={rendering}
              aria-pressed={colorMode === mode}
              onClick={() => onColorModeChange(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.themeControl} role="group" aria-label="Map theme">
          <span>Map</span>
          {(["dark", "light"] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              className={`${styles.secondaryButton} ${mapTheme === theme ? styles.themeButtonActive : ""}`}
              disabled={rendering}
              aria-pressed={mapTheme === theme}
              onClick={() => onMapTheme(theme)}
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
            onClick={() => onVideoFormat(format)}
          >
            {VIDEO_FORMATS[format].label}
          </button>
        ))}
      </div>
      </div>
      <button type="button" className={styles.secondaryButton} disabled={rendering} onClick={onRecenter}>Center on tracks</button>
    </div>
  );
}

/** Slider plus exact number input; the number is only applied (and clamped) on Enter or blur. */
function ClipLength({ seconds, disabled, onChange }: { seconds: number; disabled: boolean; onChange: (seconds: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) onChange(clampClipSeconds(Number(draft)));
    setDraft(null);
  };
  return <div className={styles.themeControl} role="group" aria-label="Clip length">
    <span>Length</span>
    <input type="range" min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={1} value={seconds} disabled={disabled}
      aria-label="Clip length in seconds (slider)" onChange={event => onChange(Number(event.target.value))} />
    <input type="number" className={styles.lengthInput} min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={1} value={draft ?? seconds} disabled={disabled}
      aria-label="Clip length in seconds" onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") commit(); }} />
    <span>s</span>
  </div>;
}
