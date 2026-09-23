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

// OAuth status type retained for later.
// type IntervalsStatus = { configured: boolean; connected: boolean; athleteName: string | null };
type ImportProgress = { completed: number; total: number; imported: number; skipped: number };

/* OAuth error mapping retained for later.
const oauthErrors: Record<string, string> = {
  access_denied: "Intervals.icu access was not granted.",
  invalid_state: "The Intervals.icu connection expired or could not be verified. Please try again.",
  token_exchange_failed: "Intervals.icu could not finish the connection. Please try again.",
  not_configured: "Intervals.icu is not configured on this server.",
  authorization_failed: "Intervals.icu authorization failed. Please try again.",
};
*/

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [apiKey, setApiKey] = useState("");
  // OAuth: const [intervals, setIntervals] = useState<IntervalsStatus | null>(null);
  const [dragging, setDragging] = useState(false);
  // OAuth: const autoImportStarted = useRef(false);

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
      const { readFitInputs } = await import("@/lib/read-fit-inputs");
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
      const { readFitFiles } = await import("@/lib/read-fit-files");
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
    setApiKey("");
    setImportProgress({ completed: 0, total: 0, imported: 0, skipped: 0 });
    setError("");
    const orderedTracks = new Map<number, Track>();
    try {
      const response = await fetch("/api/intervals/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key }) });
      if (!response.ok || !response.body) {
        const result = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
        throw new Error(result?.error || "The Intervals.icu import could not start.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let fatal = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "start") {
          setImportProgress({ completed: 0, total: event.total, imported: 0, skipped: event.stubCount });
          if (event.stubCount) setSkipped([`${event.stubCount} Strava-only activit${event.stubCount === 1 ? "y was" : "ies were"} unavailable to connected apps.`]);
        } else if (event.type === "track") {
          orderedTracks.set(event.index, event.track as Track);
        } else if (event.type === "skip") {
          setSkipped(previous => [...previous, event.message]);
        } else if (event.type === "progress") {
          setImportProgress({ completed: event.completed, total: event.total, imported: event.imported, skipped: event.skipped });
        } else if (event.type === "done") {
          setTracks([...orderedTracks.entries()].sort((a, b) => a[0] - b[0]).map(([, track]) => track));
        } else if (event.type === "fatal") {
          fatal = event.message;
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(handle);
        if (done) break;
      }
      if (pending) handle(pending);
      if (fatal) throw new Error(fatal);
      if (!orderedTracks.size) setError("No map tracks were available in the latest Intervals.icu activities.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Intervals.icu import failed.");
    } finally {
      setBusy(false);
    }
  }

  /* OAuth connection lifecycle retained for later; API keys are used per import.
  async function disconnectIntervals() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/intervals/disconnect", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Intervals.icu could not be disconnected.");
      setIntervals(current => ({ configured: current?.configured ?? true, connected: false, athleteName: null }));
      if (result.warning) setError(result.warning);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Intervals.icu could not be disconnected.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get("intervals_error");
      if (oauthError) setError(oauthErrors[oauthError] ?? "Intervals.icu authorization failed.");
      if (params.has("intervals") || oauthError) window.history.replaceState({}, "", window.location.pathname);
      try {
        const response = await fetch("/api/intervals/status", { cache: "no-store" });
        const status = await response.json() as IntervalsStatus;
        setIntervals(status);
        if (status.connected && !autoImportStarted.current) {
          autoImportStarted.current = true;
          await importIntervals();
        }
      } catch {
        setIntervals({ configured: false, connected: false, athleteName: null });
      }
    })();
    // The initial status check intentionally runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  */

  const latestStep = useRef<HTMLElement>(null);
  useEffect(() => {
    if (tracks.length) latestStep.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tracks]);

  const clipDurations = trackDurationsMs(tracks);
  const totalFileMb = Math.round(files.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024));

  return <main className={styles.page}><section className={styles.panel} aria-busy={busy}>
    <p className={styles.kicker}>RideMapClip · Up to 200 rides</p>
    <h1>See where you rode.</h1>
    <p className={styles.subtitle}>Use Intervals.icu to import your latest 100 activities automatically, or add FIT recordings from your device.</p>
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
    <section className={styles.integrationCard} aria-labelledby="intervals-title">
      <div>
        <h2 id="intervals-title">Intervals.icu</h2>
        <p className={styles.hint}>Import your latest 100 activities. Find your API key under Developer Settings in <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer">Intervals.icu settings</a>.</p>
        <p id="api-key-help" className={styles.hint}>Your key is used only for this import and is not saved. Personal keys grant broader access, but this app only reads activities.</p>
      </div>
      <form className={styles.integrationActions} onSubmit={event => { event.preventDefault(); if (!busy && apiKey.trim()) void importIntervals(apiKey.trim()); }}>
        <label htmlFor="intervals-api-key">API key</label>
        <input id="intervals-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} required disabled={busy} aria-describedby="api-key-help" />
        <button type="submit" className={styles.primaryButton} disabled={busy || !apiKey.trim()}>{importProgress ? "Importing activities…" : "Import latest 100"}</button>
      </form>
      {/* OAuth connection UI retained below for a future release.
    <section className={styles.integrationCard} aria-labelledby="intervals-title">
      <div>
        <h2 id="intervals-title">Intervals.icu</h2>
        <p className={styles.hint}>{intervals?.connected
          ? `Connected as ${intervals.athleteName}. Your latest 100 activities import automatically.`
          : intervals?.configured
            ? "Connect with read-only activity access. No ride picker is needed."
            : intervals === null ? "Checking connection…" : "Add the Intervals.icu server settings to enable this connection."}</p>
      </div>
      <div className={styles.integrationActions}>
        {intervals?.connected ? <>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={importIntervals}>Refresh latest 100</button>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={disconnectIntervals}>Disconnect</button>
        </> : intervals?.configured
          ? <a className={styles.primaryButton} href="/api/intervals/connect" aria-disabled={busy}>Connect Intervals.icu</a>
          : <button type="button" className={styles.primaryButton} disabled>Connect Intervals.icu</button>}
      </div>
      {importProgress && <p className={styles.importProgress} role="status">{busy ? "Importing" : "Imported"} {importProgress.completed} of {importProgress.total} available activities · {importProgress.imported} tracks · {importProgress.skipped} skipped</p>}
    </section>
   
      */}
    </section> <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
      onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files)); }}>
      <label htmlFor="fit-file"><strong>Drop FIT files or ZIP archives here</strong><span>or choose recordings from your device</span></label>
      <input id="fit-file" type="file" accept=".fit,.zip" multiple disabled={busy} aria-describedby="file-help" onChange={(event) => {
        selectFiles(Array.from(event.target.files ?? [])); event.target.value = "";
      }} />
      <p id="file-help" className={styles.hint}>Up to 200 FIT files · 20 MB per FIT · 100 MB per ZIP · 500 MB extracted total · GPS required</p>
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
