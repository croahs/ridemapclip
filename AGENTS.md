<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## RideMapClip product rules

- Every clip must have exactly 30 seconds of content. This applies to track previews and all future rendered/exported clips, regardless of ride length or file count.
- Use `CLIP_DURATION_SECONDS` / `CLIP_DURATION_MS` from `lib/clip.ts` as the single duration source. Do not add duration or speed parameters unless the user explicitly changes this requirement.
- Preview pause/resume does not change clip length; it only pauses the playback clock.

- Normalize track finish times by moving duration (excluding pauses): the longest ride finishes at 30 seconds; shorter rides finish at 30 × (ride moving duration / longest moving duration). Keep completed tracks visible. Unknown durations use 30 seconds with a visible explanation.
