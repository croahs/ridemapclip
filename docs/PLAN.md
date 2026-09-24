# Restructure plan

Agreed with Peder on 2026-09-23 after a fresh-eyes audit. Work through the
phases in order; each phase ends green (`pnpm check`) and in its own commit(s).
Delete this file when the last phase lands, and fold anything durable into
AGENTS.md or README instead.

## Done

- Phase 0: history purged; GitHub repo and Vercel project recreated from clean history.
- Phase 1: pnpm, `.gitattributes`, dead code removed (OAuth at tag `parked/oauth`,
  upload route, Copilot file, fonts, template SVGs, unused CSS), `pnpm check`,
  CI, hermetic browser tests (synthetic FIT, stubbed tiles, Chrome).
- Phase 2: Intervals.icu import runs in the browser (`importLatestActivities`),
  `app/api/` deleted, Next.js replaced by Vite (`vercel.json` sets the
  framework). Verified from production: Intervals.icu answers the browser (CORS);
  a full import with a real key is still unverified.
- Phase 3: `lib/clip-renderer` draws preview and video from one `CLIP_STYLE`;
  glow tails use per-zoom pixel routes; the MP4 is encoded in a worker; clip
  length is user-selectable 15–120 s. Timing modules merged into `lib/clip.ts`.
  Export of 200 one-hour rides: 65.4 s -> 21.6 s (30 s clip).

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
