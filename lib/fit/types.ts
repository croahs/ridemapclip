import type { Track } from "../track";

/** One decoded GPS sample, used only while parsing (timing needs timestamps). */
export type TrackPoint = {
  latitude: number;
  longitude: number;
  timestamp: string | null;
  breakBefore: boolean;
};
export type FitWorkerRequest = { buffer: ArrayBuffer; name: string };
export type FitWorkerResult =
  | { kind: "track"; track: Track }
  | { kind: "skipped"; message: string }
  | { kind: "error"; message: string };
