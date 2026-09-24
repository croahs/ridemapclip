import type { Track } from "../track";
export type FitWorkerRequest = { buffer: ArrayBuffer; name: string };
export type FitWorkerResult =
  | { kind: "track"; track: Track }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };
