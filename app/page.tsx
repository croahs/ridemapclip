"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { MAX_FIT_FILES, validateFitBatch } from "@/lib/fit";
import { getTrackColor } from "@/lib/track-colors";
import { trackDurationsMs } from "@/lib/clip-timing";
import { formatHumanDuration } from "@/lib/format";
import type { Track } from "@/lib/track";
import styles from "./page.module.css";

const TrackMap = dynamic(() => import("./track-map"), { ssr: false, loading: () => <p className={styles.mapLoading} role="status">Loading your map…</p> });

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function selectFiles(incoming: File[]) {
    if (busy || incoming.length === 0) return;
    const combined = [...files, ...incoming];
    const validation = validateFitBatch(combined);
    if (validation) { setError(validation + " Your existing selection is unchanged."); return; }
    const keys = combined.map((file) => JSON.stringify([file.name, file.size, file.lastModified]));
    if (new Set(keys).size !== keys.length) { setError("That selection contains a file already added. Choose different files or remove the existing copy first."); return; }
    setFiles(combined);
    setTracks([]); setSkipped([]);
    setError("");
  }

  async function createTracks() {
    if (!files.length || busy) return;
    setBusy(true);
    setTracks([]); setSkipped([]);
    setError("");
    setUploadProgress({ current: 0, total: files.length });

    const CHUNK_SIZE = 15;
    const accumulated: Track[] = [];

    try {
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        const form = new FormData();
        chunk.forEach((file) => form.append("files", file));

        const response = await fetch("/api/upload", { method: "POST", body: form });
        if (!response.headers.get("content-type")?.includes("application/json")) {
          throw new Error("The upload could not be processed. Try fewer or smaller FIT files.");
        }
        const result = await response.json();
        if (!response.ok || !result.ok || !Array.isArray(result.tracks)) {
          throw new Error(result.error || "The tracks could not be created.");
        }
        accumulated.push(...result.tracks);
        if (Array.isArray(result.skipped)) setSkipped(previous => [...previous, ...result.skipped]);
        setUploadProgress({ current: Math.min(files.length, i + CHUNK_SIZE), total: files.length });
      }
      setTracks(accumulated);
      if (!accumulated.length) setError("No tracks could be created. All selected files had fewer than two usable GPS points.");
    } catch (failure) {
      setError(failure instanceof TypeError ? "Could not reach the app. Check that the development server is running and try again." : failure instanceof Error ? failure.message : "The tracks could not be created.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  const latestStep = useRef<HTMLElement>(null);
  useEffect(() => {
    if (tracks.length) latestStep.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tracks]);

  const clipDurations = trackDurationsMs(tracks);
  const totalFileMb = Math.round(files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024));

  return <main className={styles.page}><section className={styles.panel} aria-busy={busy}>
    <p className={styles.kicker}>RideMapClip · Up to 200 rides</p>
    <h1>See where you rode.</h1>
    <p className={styles.subtitle}>Add up to 200 FIT recordings. Explore them on one map, then animate every track together in a single 30-second clip.</p>
    {!!tracks.length && <section ref={latestStep} className={styles.trackSection} aria-labelledby="track-title">
      <h2 id="track-title">Your tracks</h2>
      <p className={styles.success} role="status">{tracks.length.toLocaleString()} track(s) created — {tracks.reduce((sum, track) => sum + track.points.length, 0).toLocaleString()} GPS points.</p>
      <TrackMap tracks={tracks} />
      <ul className={styles.trackCards} aria-label="Track legend and ride summaries">{tracks.map((track, index) => <li key={`${track.name}-${index}`} className={styles.trackCard} style={{ "--track-color": getTrackColor(index, tracks.length) } as CSSProperties}>
        <h3>{index + 1}. {track.name}</h3>
        <p>GPS distance: {(track.distanceMeters / 1000).toLocaleString(undefined, {maximumFractionDigits: 2})} km · Moving time: {formatHumanDuration(track.movingSeconds)} · {track.points.length.toLocaleString()} GPS points · Finishes at {(clipDurations[index] / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}s in the clip</p>
        {!!track.warnings.length && <ul className={styles.warnings}>{track.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </li>)}</ul>
      <p className={styles.hint}>All tracks start together. The longest moving time becomes 30 seconds; shorter rides finish proportionally earlier and stay visible. Pauses are excluded from ride timing; movement along each route remains steady.</p>
    </section>}
    <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="fit-file"><strong>Drop up to 200 FIT files here</strong><span>or choose recordings from your device</span></label>
      <input id="fit-file" type="file" accept=".fit" multiple disabled={busy} aria-describedby="file-help" onChange={(event) => {
        selectFiles(Array.from(event.target.files ?? [])); event.target.value = "";
      }} />
      <p id="file-help" className={styles.hint}>Add files together or in batches · 20 MB per file · 500 MB total · GPS required</p>
    </div>
    <div className={styles.fileSelectionSummary}>
      <p className={styles.hint} role="status">{files.length} of {MAX_FIT_FILES} files selected{files.length > 0 ? ` (${totalFileMb} MB)` : ""}</p>
      {files.length > 0 && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => { setFiles([]); setTracks([]); setSkipped([]); setError(""); }}>Clear all</button>}
    </div>
    {!!files.length && <ul className={styles.fileQueue}>{files.map((file, index) => <li key={`${file.name}-${index}`}>
      <span>{index + 1}. {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</span>
      <button className={styles.secondaryButton} type="button" disabled={busy} aria-label={`Remove ${file.name}`} onClick={() => {
        setFiles(files.filter((_, i) => i !== index)); setTracks([]); setSkipped([]); setError("");
      }}>Remove</button>
    </li>)}</ul>}
    <button type="button" className={styles.primaryButton} onClick={createTracks} disabled={!files.length || busy}>
      {busy ? (uploadProgress ? `Reading your rides… (${uploadProgress.current} / ${uploadProgress.total})` : "Reading your rides…") : `Create ${files.length ? files.length : ""} track${files.length === 1 ? "" : "s"}`}
    </button>
    <p className={styles.hint}>Files are processed by this app and aren’t saved. Adding or removing a file clears the current preview.</p>
    {busy && <p role="status" className={styles.hint}>Checking recordings, validating integrity, and decoding GPS coordinates…</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {skipped.length > 0 && <div role="status"><p className={styles.hint}>{skipped.length} file(s) skipped because they had insufficient GPS data:</p><ul className={styles.warnings}>{skipped.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul></div>}

  </section></main>;
}
