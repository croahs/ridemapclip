export type MapTheme = "dark" | "light";

export const MAP_THEMES: readonly MapTheme[] = ["dark", "light"];

// The light treatment begins as an inversion of the established dark map, then
// deliberately darkens it so map detail stays secondary to the coloured trails.
export function mapTileFilter(theme: MapTheme) {
  const dark = "invert(1) saturate(0.25) hue-rotate(213deg) saturate(5.2) brightness(0.57)";
  return theme === "dark" ? dark : "none";
}

export function glowOpacityMultiplier(theme: MapTheme) {
  return theme === "dark" ? 0.5 : 1;
}
