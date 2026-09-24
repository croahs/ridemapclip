import { expandFitInputs } from "./zip";

self.onmessage = async (event: MessageEvent<{ incoming: File[]; existing: { name: string; size: number }[] }>) => {
  try {
    self.postMessage({ ok: true, ...await expandFitInputs(event.data.incoming, event.data.existing) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "The ZIP could not be opened." });
  }
};
