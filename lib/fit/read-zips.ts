export async function readFitInputs(incoming: File[], existing: File[]) {
  const worker = new Worker(new URL("./zip.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<{ files: File[]; ignored: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ZIP extraction took too long. Try a smaller archive.")), 60_000);
      const fail = () => { clearTimeout(timer); reject(new Error("The ZIP reader stopped unexpectedly. Try a smaller archive.")); };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = (event: MessageEvent<{ ok: boolean; files: File[]; ignored: number; error: string }>) => {
        clearTimeout(timer);
        if (event.data.ok) resolve({ files: event.data.files, ignored: event.data.ignored });
        else reject(new Error(event.data.error));
      };
      try { worker.postMessage({ incoming, existing: existing.map(({ name, size }) => ({ name, size })) }); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
  } finally {
    worker.terminate();
  }
}
