import type { MapTheme } from "./map-theme";
import type { ClipView } from "./clip-renderer";
import type { Track } from "./track";

/** Where the captured map sits inside the video frame, in video pixels. */
export type MapFrame = { x: number; y: number; width: number; height: number };

/** The map view is frozen at capture time: later map movement cannot change the video. */
export type RenderRequest = { tracks: Track[]; clipMs: number; theme: MapTheme; width: number; height: number; background: ImageBitmap; view: ClipView; frame: MapFrame };

export type RenderMessage =
  | { type: "progress"; fraction: number; message: string }
  | { type: "done"; buffer: ArrayBuffer }
  | { type: "error"; message: string };
