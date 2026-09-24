# AGENTS.md

RideMapClip is a static Vite + React app: everything runs in the browser, with no backend. User-facing behaviour is described in `README.md`; this file holds the rules and the map.

## Commands and gates

- pnpm only. `pnpm check` (typecheck, lint, unit tests) must pass before any commit.
- Anything that touches the UI, rendering or file reading: also `pnpm build && pnpm test:browser` (needs Google Chrome; tests use synthetic FIT files and stubbed tiles).
- Rendering performance: `PERF=1 pnpm test:browser export-perf`, before and after.
- Pushing `main` deploys to https://ridemapclip.vercel.app (Vercel, `vercel.json`) and runs CI (`.github/workflows/ci.yml`). After UI changes, verify the deploy: `BASE_URL=https://ridemapclip.vercel.app pnpm test:browser`.
- `fitexample/` is Peder's private ride set (gitignored). Never commit it or other real rides; they contain home locations.

## Product rules

- The user chooses the clip length, 15–120 seconds (default 30). `CLIP_SECONDS` in `lib/clip/timing.ts` owns the limits; preview, video and ride timing take the chosen length as a parameter. No speed setting.
- Normalize finish times by moving duration (excluding pauses): the longest ride finishes at the clip end; shorter rides finish at clip length × (ride moving duration / longest moving duration). Keep completed tracks visible. Unknown durations use the full clip with a visible explanation.
- Pause/resume only pauses the playback clock; it never changes clip length.
- Preview and video are drawn by the same code (`lib/clip/renderer.ts`, look in `CLIP_STYLE`). Change the look there, never in only one of them.
- Ride files never leave the browser. The Intervals.icu API key goes only to Intervals.icu and is never stored.

## Layout

- `index.html`, `app/main.tsx`: entry. `app/app.tsx`: file selection, Intervals.icu import, track list.
- `app/track-map.tsx`: the preview screen; `use-clip-preview.ts` owns the Leaflet map, canvas layers and playback clock; `playback-panel.tsx`, `map-toolbar.tsx`, `video-export.tsx`, `intervals-card.tsx` are its UI parts.
- `lib/fit/`: limits, FIT parsing and moving time, ZIP expansion, and the workers that run them.
- `lib/clip/`: `timing.ts` (clip length, clock, finish times, video frames), `playback.ts` (position along a route), `renderer.ts` (all drawing), `export*.ts` (map capture and MP4 encoding in a worker), plus formats, themes and colours.
- `lib/intervals.ts`: Intervals.icu import. `lib/track.ts`: the track model. `lib/format.ts`: display formatting.
- `tests/*.test.ts`: unit tests (node:test via tsx). `tests/browser/`: Playwright.

## Known traps

- Playwright starts `vite preview` through `node node_modules/vite/bin/vite.js`, not `pnpm`: through the pnpm wrapper the server outlived the test run on Linux and hung CI.
- Intervals.icu allows browser calls (CORS with `Authorization`); if that ever changes, the import needs a proxy again.
