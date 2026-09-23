import { readFit } from "./parse-fit";
import type { FitWorkerRequest } from "./fit-worker-types";

self.onmessage = (event: MessageEvent<FitWorkerRequest>) => {
  self.postMessage(readFit(event.data.buffer, event.data.name));
};
