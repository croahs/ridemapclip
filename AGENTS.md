# AGENTS.md

RideMapClip is a static Vite + React app: everything runs in the browser, with no backend.
Use pnpm. `pnpm check` (typecheck, lint, unit tests) must pass; `pnpm build && pnpm test:browser` covers the browser.
Active restructure work is tracked in `docs/PLAN.md`.

## RideMapClip product rules

- The user chooses the clip length, 15–120 seconds (default 30). `CLIP_SECONDS` in `lib/clip.ts` owns the limits; preview, video and ride timing all take the chosen length as a parameter. No speed setting.
- Normalize finish times by moving duration (excluding pauses): the longest ride finishes at the clip end; shorter rides finish at clip length × (ride moving duration / longest moving duration). Keep completed tracks visible. Unknown durations use the full clip with a visible explanation.
- Pause/resume only pauses the playback clock; it never changes clip length.
- Preview and video are drawn by the same code (`lib/clip-renderer.ts`, style in `CLIP_STYLE`). Change the look there, never in only one of them.
