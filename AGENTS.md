# AGENTS.md

RideMapClip is a static Vite + React app: everything runs in the browser, with no backend.
Use pnpm. `pnpm check` (typecheck, lint, unit tests) must pass; `pnpm build && pnpm test:browser` covers the browser.
Active restructure work is tracked in `docs/PLAN.md`; it overrides this file where they conflict.

## RideMapClip product rules

- Every clip must have exactly 30 seconds of content. This applies to track previews and all future rendered/exported clips, regardless of ride length or file count.
- Use `CLIP_DURATION_SECONDS` / `CLIP_DURATION_MS` from `lib/clip.ts` as the single duration source. Do not add duration or speed parameters unless the user explicitly changes this requirement.
- Preview pause/resume does not change clip length; it only pauses the playback clock.

- Normalize track finish times by moving duration (excluding pauses): the longest ride finishes at 30 seconds; shorter rides finish at 30 × (ride moving duration / longest moving duration). Keep completed tracks visible. Unknown durations use 30 seconds with a visible explanation.
