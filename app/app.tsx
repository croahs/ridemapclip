import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { MAX_BATCH_BYTES, MAX_FIT_BYTES, MAX_FIT_FILES, MAX_ZIP_BYTES, formatBytes, validateFitBatch } from "@/lib/fit/limits";
import { getTrackColor } from "@/lib/clip/track-colors";
import { CLIP_SECONDS, trackDurationsMs } from "@/lib/clip/timing";
import { formatHumanDuration } from "@/lib/format";
import type { Track } from "@/lib/track";
import type { ImportProgress } from "@/lib/intervals";
import IntervalsCard from "./intervals-card";
import styles from "./app.module.css";

const TrackMap = lazy(() => import("./track-map"));

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clipSeconds, setClipSeconds] = useState<number>(CLIP_SECONDS.default);

  const selecting = useRef(false);
  const [extracting, setExtracting] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState("");

  async function selectFiles(incoming: File[]) {
    if (busy || selecting.current || incoming.length === 0) return;
    selecting.current = true;
    setBusy(true); setExtracting(true); setArchiveNotice("");
    try {
    let expanded = incoming;
    if (incoming.some(file => /\.zip$/i.test(file.name))) {
      const { readFitInputs } = await import("@/lib/fit/read-zips");
      const result = await readFitInputs(incoming, files);
      expanded = result.files;
      if (result.ignored) setArchiveNotice("Ignored " + result.ignored + " non-FIT archive file(s).");
    }
    const combined = [...files, ...expanded];
    const validation = validateFitBatch(combined);
    if (validation) { setError(validation + " Your existing selection is unchanged."); return; }
    const keys = combined.map((file) => JSON.stringify([file.name, file.size, file.lastModified]));
    if (new Set(keys).size !== keys.length) { setError("That selection contains a file already added. Choose different files or remove the existing copy first."); return; }
    setFiles(combined);
    setTracks([]); setSkipped([]); setImportProgress(null);
    setError("");
    } catch (failure) {
      setError((failure instanceof Error ? failure.message : "The archive could not be read.") + " Your existing selection is unchanged.");
    } finally {
      selecting.current = false; setBusy(false); setExtracting(false);
    }
  }

  async function createTracks() {
    if (!files.length || busy) return;
    setBusy(true);
    setTracks([]); setSkipped([]);
    setError("");
    setUploadProgress({ current: 0, total: files.length });

    try {
      const { readFitFiles } = await import("@/lib/fit/read-files");
      const result = await readFitFiles(files, current => setUploadProgress({ current, total: files.length }));
      setTracks(result.tracks);
      setSkipped(result.skipped);
      if (!result.tracks.length) setError("No tracks could be created. All selected files had fewer than two usable GPS points.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The recordings could not be read. Please try again.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function importIntervals(key: string) {
    if (busy) return;
    setBusy(true);
    setFiles([]); setTracks([]); setSkipped([]);
    setImportProgress({ completed: 0, total: 0, imported: 0, skipped: 0 });
    setError("");
    let reader: ReturnType<typeof import("@/lib/fit/read-files")["createFitReader"]> | null = null;
    try {
      const [{ importLatestActivities }, { createFitReader }] = await Promise.all([import("@/lib/intervals"), import("@/lib/fit/read-files")]);
      reader = createFitReader();
      const result = await importLatestActivities(key, reader.read, setImportProgress);
      setTracks(result.tracks);
      setSkipped(result.skipped);
      if (!result.tracks.length) setError("No map tracks were available in the latest Intervals.icu activities.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Intervals.icu import failed.");
    } finally {
      reader?.close();
      setBusy(false);
    }
  }

  const latestStep = useRef<HTMLElement>(null);
  useEffect(() => {
    if (tracks.length) latestStep.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tracks]);

  const clipDurations = trackDurationsMs(tracks, clipSeconds * 1000);
  const totalFileMb = Math.round(files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024));

  return <main className={styles.page}><section className={styles.panel} aria-busy={busy}>
    <p className={styles.kicker}>RideMapClip · Up to {MAX_FIT_FILES.toLocaleString()} rides</p>
    <h1>See where you rode.</h1>
    <p className={styles.subtitle}>Use Intervals.icu to import your latest 100 activities automatically, or add FIT recordings from your device.</p>
    {!!tracks.length && <section ref={latestStep} className={styles.trackSection} aria-labelledby="track-title">
      <h2 id="track-title">Your tracks</h2>
      <p className={styles.success} role="status">{tracks.length.toLocaleString()} track(s) created — {tracks.reduce((sum, track) => sum + track.path.latitudes.length, 0).toLocaleString()} GPS points.</p>
      <Suspense fallback={<p className={styles.mapLoading} role="status">Loading your map…</p>}><TrackMap tracks={tracks} clipSeconds={clipSeconds} onClipSecondsChange={setClipSeconds} /></Suspense>
      <ul className={styles.trackCards} aria-label="Track legend and ride summaries">{tracks.map((track, index) => <li key={`${track.name}-${index}`} className={styles.trackCard} style={{ "--track-color": getTrackColor(index, tracks.length) } as CSSProperties}>
        <h3>{index + 1}. {track.name}</h3>
        <p>GPS distance: {(track.distanceMeters / 1000).toLocaleString(undefined, {maximumFractionDigits: 2})} km · Moving time: {formatHumanDuration(track.movingSeconds)} · {track.path.latitudes.length.toLocaleString()} GPS points · Finishes at {(clipDurations[index] / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}s in the clip</p>
        {!!track.warnings.length && <ul className={styles.warnings}>{track.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      </li>)}</ul>
      <p className={styles.hint}>All tracks start together. The longest moving time becomes {clipSeconds} seconds; shorter rides finish proportionally earlier and stay visible. Pauses are excluded from ride timing; movement along each route remains steady.</p>
    </section>}
    <IntervalsCard busy={busy} progress={importProgress} onImport={key => void importIntervals(key)} />
    <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="fit-file"><strong>Drop FIT files or ZIP archives here</strong><span>or choose recordings from your device</span></label>
      <input id="fit-file" type="file" accept=".fit,.zip" multiple disabled={busy} aria-describedby="file-help" onChange={(event) => {
        selectFiles(Array.from(event.target.files ?? [])); event.target.value = "";
      }} />
      <p id="file-help" className={styles.hint}>Up to {MAX_FIT_FILES.toLocaleString()} FIT files · {formatBytes(MAX_FIT_BYTES)} per FIT · {formatBytes(MAX_ZIP_BYTES)} per ZIP · {formatBytes(MAX_BATCH_BYTES)} extracted total · GPS required</p>
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
      {busy ? (extracting ? "Opening your files…" : importProgress ? "Intervals.icu import in progress…" : uploadProgress ? `Reading your rides… (${uploadProgress.current} / ${uploadProgress.total})` : "Reading your rides…") : `Create ${files.length ? files.length : ""} track${files.length === 1 ? "" : "s"}`}
    </button>
    <p className={styles.hint}>Selected files are processed in your browser and are not uploaded. Adding or removing a file clears the current preview.</p>
    {busy && uploadProgress && <p role="status" className={styles.hint}>Checking recordings, validating integrity, and decoding GPS coordinates…</p>}
    {extracting && <p role="status" className={styles.hint}>Opening files and checking archive limits…</p>}
    {archiveNotice && <p role="status" className={styles.hint}>{archiveNotice}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {skipped.length > 0 && <div role="status"><p className={styles.hint}>{importProgress ? "Intervals.icu activity skips:" : `${skipped.length} file(s) skipped because they had insufficient GPS data:`}</p><ul className={styles.warnings}>{skipped.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul></div>}

  </section></main>;
}
