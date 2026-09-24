import { useState } from "react";
import type { ImportProgress } from "@/lib/intervals";
import styles from "./app.module.css";

/** API-key form for the Intervals.icu import. The key is cleared as soon as the import starts. */
export default function IntervalsCard({ busy, progress, onImport }: { busy: boolean; progress: ImportProgress | null; onImport: (apiKey: string) => void }) {
  const [apiKey, setApiKey] = useState("");
  return <section className={styles.integrationCard} aria-labelledby="intervals-title">
    <div>
      <h2 id="intervals-title">Intervals.icu</h2>
      <p className={styles.hint}>Import your latest 100 activities. Find your API key under Developer Settings in <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer">Intervals.icu settings</a>.</p>
      <p id="api-key-help" className={styles.hint}>Your key goes straight from your browser to Intervals.icu, is used only for this import and is not saved. Personal keys grant broader access, but this app only reads activities.</p>
    </div>
    <form className={styles.integrationActions} onSubmit={event => {
      event.preventDefault();
      const key = apiKey.trim();
      if (busy || !key) return;
      setApiKey("");
      onImport(key);
    }}>
      <label htmlFor="intervals-api-key">API key</label>
      <input id="intervals-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="off" spellCheck={false} maxLength={256} required disabled={busy} aria-describedby="api-key-help" />
      <button type="submit" className={styles.primaryButton} disabled={busy || !apiKey.trim()}>{busy && progress ? "Importing activities…" : "Import latest 100"}</button>
    </form>
    {progress && <p className={styles.importProgress} role="status">{busy ? "Importing" : "Imported"} {progress.completed} of {progress.total} available activities · {progress.imported} tracks · {progress.skipped} skipped</p>}
  </section>;
}
