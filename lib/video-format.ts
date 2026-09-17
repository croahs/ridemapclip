export type VideoFormat = "landscape" | "square" | "portrait";

export const VIDEO_FORMATS: Record<VideoFormat, { label: string; width: number; height: number; aspectRatio: string }> = {
  landscape: { label: "16:9", width: 1920, height: 1080, aspectRatio: "16 / 9" },
  square: { label: "1:1", width: 1080, height: 1080, aspectRatio: "1 / 1" },
  portrait: { label: "9:16", width: 1080, height: 1920, aspectRatio: "9 / 16" },
};
