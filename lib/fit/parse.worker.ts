import { readFit } from "./parse";
import type { FitWorkerRequest } from "./types";

self.onmessage = (event: MessageEvent<FitWorkerRequest>) => {
  self.postMessage(readFit(event.data.buffer, event.data.name));
};
