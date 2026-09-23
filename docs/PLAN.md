# Restructure plan

Agreed with Peder on 2026-09-23 after a fresh-eyes audit. Work through the
phases in order; each phase ends green (`pnpm check`) and in its own commit(s).
Delete this file when the last phase lands, and fold anything durable into
AGENTS.md or README instead.

Where this plan conflicts with AGENTS.md, this plan wins: it records decisions
Peder made after AGENTS.md was written (notably the clip-duration rule).

## Decisions

| Topic | Decision |
|---|---|
| Backend | Remove it. Intervals.icu import runs in the browser; the app is a static site. |
| Framework | Migrate Next.js → Vite + React (static build, still hosted on Vercel). |
| Package manager | pnpm. Remove `package-lock.json`. |
| Clip duration | User picks 15–120 s. Replaces the fixed 30-second rule. |

## Done

- Phase 0: history purged; GitHub repo and Vercel project recreated from clean history.
- Phase 1: pnpm, `.gitattributes`, dead code removed (OAuth at tag `parked/oauth`,
  upload route, Copilot file, fonts, template SVGs, unused CSS), `pnpm check`,
  CI, hermetic browser tests (synthetic FIT, stubbed tiles, Chrome).

## Phase 2 — static app

1. Move the Intervals.icu import into the browser. CORS was verified on
   2026-09-23: both `/api/v1/athlete/0/activities` and
   `/api/v1/activity/{id}/fit-file` answer preflights with
   `Access-Control-Allow-Origin` echoing the origin and allowing
   `authorization`. Keep existing behaviour: 100 latest, concurrency 3,
   `Retry-After` handling, size limits, Strava-stub skips. Decode gzip with
   `DecompressionStream("gzip")`; parse FIT in the existing worker. The key
   goes only to Intervals.icu; update the UI copy to say so.
2. Delete `app/api/` entirely, then migrate to Vite + React:
   `index.html` holds title/OpenGraph metadata, workers keep
   `new URL(..., import.meta.url)`, remove `next`, `eslint-config-next`,
   `next-env.d.ts` and the Next.js block in AGENTS.md. Vercel project
   settings (framework preset/output dir) need updating — unknown what they
   are today; check before deploying.
- Verify on the rendered page (local build preview) and on the Vercel deploy:
  local FIT, ZIP, Intervals import, playback, video export.

## Phase 3 — renderer and performance

Measure export time for 2 and 200 tracks before and after each step.

1. One source for visual constants (glow tails, trail widths, rider radius,
   large-pack threshold, fit padding, watermark URL) — today duplicated in
   `app/track-map.tsx` and `lib/render-video.ts`.
2. Tail-only glow geometry. `playbackFrame` rebuilds every drawn section per
   track per frame, and export projects them all, but only the last section's
   tail is used. Compute just the tail from the current index.
3. One `drawFrame(ctx, scene, elapsedMs, projection)` used by both preview
   (canvas overlay on Leaflet) and export, so the preview is exactly the
   video, including time badge, watermark and attribution.
4. Render export in a Worker with OffscreenCanvas (tile snapshot passed as an
   ImageBitmap). This removes the per-frame `setTimeout(0)` yield, which
   browsers throttle to ≥1 s in background tabs (likely cause of slow renders
   when the tab is hidden — not measured).
5. User-selectable duration, 15–120 s (default 30): slider plus number input.
   Duration becomes a scene parameter instead of a global constant;
   frame count = duration × fps. Keep the normalization rule (longest moving
   duration finishes at the chosen duration; shorter rides proportionally
   earlier; unknown durations use the full clip with a notice). Check memory
   for 120 s at 1920×1080 with the in-memory MP4 target. Fix the `0:{sec}`
   time display, which assumes clips under a minute. Rewrite the AGENTS.md
   product rules to match.

## Phase 4 — structure and docs

- Group `lib/` by domain: `lib/fit/` (validation, parsing, moving time, ZIP,
  workers), `lib/clip/` (timing, playback, trail order, renderer, formats,
  themes), `lib/intervals/`. Deduplicate the dateline longitude unwrap
  (`track.ts` and `playback.ts`).
- Split `app/track-map.tsx` (541 lines) into a playback-engine hook and small
  components (controls, telemetry, toolbar, fullscreen overlay). Extract the
  Intervals import and file queue from `app/page.tsx`.
- AGENTS.md owns agent rules: product rules, commands, gates, a short
  architecture map, and how to verify (which surface, which command).
  README becomes user/developer-facing only and stops restating rules.
- Proposal awaiting Peder's OK: move the backlog from the gitignored
  `vibenotesridemapclip.txt` into a committed `BACKLOG.md` so agents on any
  machine can see it.
