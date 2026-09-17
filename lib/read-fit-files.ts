import { validateFitBatch } from "./fit";
import type { Track } from "./track";
import type { FitWorkerResult } from "./fit-worker-types";

/** Decode one file at a time off the main thread; no file data leaves the browser. */
export async function readFitFiles(files: File[], onProgress: (current: number) => void, signal?: AbortSignal) {
  const error = validateFitBatch(files);
  if (error) throw new Error(error);
  signal?.throwIfAborted();
  const worker = new Worker(new URL("./fit.worker.ts", import.meta.url), { type: "module" });
  const tracks: Track[] = [];
  const skipped: string[] = [];
  try {
    for (let index = 0; index < files.length; index++) {
      signal?.throwIfAborted();
      const file = files[index];
      const buffer = await file.arrayBuffer();
      signal?.throwIfAborted();
      const result = await new Promise<FitWorkerResult>((resolve, reject) => {
        const cleanup = () => {
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
          signal?.removeEventListener("abort", abort);
        };
        const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")); };
        worker.onmessage = (event: MessageEvent<FitWorkerResult>) => { cleanup(); resolve(event.data); };
        worker.onerror = () => { cleanup(); reject(new Error("The file reader could not start or stopped unexpectedly. Reload the page and try again.")); };
        worker.onmessageerror = () => { cleanup(); reject(new Error("The decoded recording could not be read. Please try again.")); };
        signal?.addEventListener("abort", abort, { once: true });
        try { worker.postMessage({ buffer, name: file.name }, [buffer]); }
        catch (error) { cleanup(); reject(error); }
      });
      if (result.kind === "error") throw new Error(result.message);
      if (result.kind === "skipped") skipped.push(result.message);
      else tracks.push(result.track);
      onProgress(index + 1);
    }
    return { tracks, skipped };
  } finally {
    worker.terminate();
  }
}
