import { useState } from "react";
import { CLIP_SECONDS, clampClipSeconds } from "@/lib/clip";
import styles from "./app.module.css";

/** Slider plus exact number input; the number is only applied (and clamped) on Enter or blur. */
export default function ClipLength({ seconds, disabled, onChange }: { seconds: number; disabled: boolean; onChange: (seconds: number) => void }) {
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
