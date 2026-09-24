# RideMapClip

Turn up to 200 GPS rides into one animated map clip. Everything runs in your browser: rides are never uploaded, and there is no backend or account.

Live at https://ridemapclip.vercel.app.

## Run locally

Use Node.js 22.13 or newer and pnpm (the version is pinned in `package.json`; `corepack enable` provides it).

```bash
pnpm install
pnpm dev
```

Open the address Vite prints (normally http://localhost:5173).

## What it does

- **Rides in:** drop up to 200 `.fit` files or ZIP archives of them (20 MB per FIT, 100 MB per ZIP, 500 MB in total), or import your latest 100 activities from Intervals.icu with a personal API key. The browser calls Intervals.icu directly; the key never reaches any other server and is not stored.
- **Tracks:** the Garmin FIT SDK validates and decodes each file in a Web Worker. Indoor or GPS-less rides are skipped and listed; damaged files are named. Recording gaps (missing GPS, time going backwards, gaps over two minutes) split the line rather than drawing across them. Distance is GPS distance and may differ from your bike computer.
- **Timing:** rides are timed by moving time (the device's value, or estimated from speed and GPS movement, excluding pauses). In the clip, all rides start together; the longest finishes at the end and shorter ones proportionally earlier.
- **Clip:** choose 15–120 seconds (default 30), a dark or light map, and 16:9, 1:1 or 9:16. The preview is drawn by the same code as the video, so it is what you will get.
- **Video:** **Create video** encodes an H.264 MP4 at 30 fps in a background worker from the map view you positioned. It needs Chrome or Edge (WebCodecs). 200 one-hour rides take about 20 s for a 30-second clip and about 70 s (roughly 120 MB) for a 120-second clip on a desktop machine.

Map tiles come from OpenStreetMap with attribution; the video uses only the tiles already on screen. Review OpenStreetMap's tile usage policy before heavier public use.

## Checks

```bash
pnpm check          # typecheck, lint, unit tests
pnpm build
pnpm test:browser   # after build; needs Google Chrome
```

CI runs all three on every push to `main` and on pull requests. Browser tests use synthetic FIT rides and stubbed map tiles, so they need no personal files or network. `PERF=1 pnpm test:browser export-perf` measures export time.

An earlier Intervals.icu OAuth implementation is preserved at the git tag `parked/oauth`.
