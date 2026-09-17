import { FitError, NoGpsFitError, parseFit } from "./parse-fit";
import type { FitWorkerRequest, FitWorkerResult } from "./fit-worker-types";

self.onmessage = (event: MessageEvent<FitWorkerRequest>) => {
  const { buffer, name } = event.data;
  let result: FitWorkerResult;
  try {
    result = { kind: "track", track: parseFit(buffer, name) };
  } catch (error) {
    const message = name + ": " + (error instanceof FitError ? error.message : "This recording could not be read. Please export it again.");
    result = { kind: error instanceof NoGpsFitError ? "skipped" : "error", message };
  }
  self.postMessage(result);
};
