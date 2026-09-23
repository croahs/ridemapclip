import { validateFitBatch } from "./fit";
import type { Track } from "./track";
import type { FitWorkerResult } from "./fit-worker-types";

/** One FIT-decoding worker; requests are queued so results never cross. */
export function createFitReader() {
  const worker = new Worker(new URL("./fit.worker.ts", import.meta.url), { type: "module" });
  let queue: Promise<unknown> = Promise.resolve();
  const decode = (buffer: ArrayBuffer, name: string) => new Promise<FitWorkerResult>((resolve, reject) => {
    const cleanup = () => { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; };
    worker.onmessage = (event: MessageEvent<FitWorkerResult>) => { cleanup(); resolve(event.data); };
    worker.onerror = () => { cleanup(); reject(new Error("The file reader could not start or stopped unexpectedly. Reload the page and try again.")); };
    worker.onmessageerror = () => { cleanup(); reject(new Error("The decoded recording could not be read. Please try again.")); };
    try { worker.postMessage({ buffer, name }, [buffer]); }
    catch (error) { cleanup(); reject(error); }
  });
  return {
    read(buffer: ArrayBuffer, name: string): Promise<FitWorkerResult> {
      const result = queue.then(() => decode(buffer, name));
      queue = result.catch(() => undefined);
      return result;
    },
    close: () => worker.terminate(),
  };
}

/** Decode one file at a time off the main thread; no file data leaves the browser. */
export async function readFitFiles(files: File[], onProgress: (current: number) => void) {
  const error = validateFitBatch(files);
  if (error) throw new Error(error);
  const reader = createFitReader();
  const tracks: Track[] = [];
  const skipped: string[] = [];
  try {
    for (let index = 0; index < files.length; index++) {
      const result = await reader.read(await files[index].arrayBuffer(), files[index].name);
      if (result.kind === "error") throw new Error(result.message);
      if (result.kind === "skipped") skipped.push(result.message);
      else tracks.push(result.track);
      onProgress(index + 1);
    }
    return { tracks, skipped };
  } finally {
    reader.close();
  }
}
