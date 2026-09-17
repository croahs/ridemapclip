# RideMapClip

Turn up to 200 outdoor FIT recordings into an interactive GPS track.

## Run locally

Use Node.js 22.13 or newer in the Node 22 line (or Node 24 LTS).

```powershell
npm.cmd install
npm.cmd run dev
```

Open the local address printed by the server (normally http://localhost:3000).
Choose one to 200 `.fit` files, then select **Create tracks**. Add files in one batch or separately; remove individual files from the selection before creating tracks. You can pan, zoom, and
return to the full track. The colored moving markers show playback position.

## Current scope

- Up to 200 files, each up to 20 MB and 200,000 GPS points (500 MB total).
- Every file gets its own color, summary, route and moving marker. Files with fewer than two usable GPS points are skipped and listed; the remaining files still create tracks. Other invalid files name the failing file and stop the preview.
- Garmin FIT SDK validates file integrity and decodes GPS record messages.
- Leaflet displays the track on OpenStreetMap with attribution.
- Coordinates, timestamps, and elevation remain available in a shared `Track`
  model for future playback and video rendering.
- GPS distance sums consecutive points, excluding detected gaps. It may differ
  from your bike computer's sensor-based distance. Playback uses moving time, excluding stops. Device moving time is preferred; otherwise it is estimated from speed or GPS movement (at least 0.5 m/s), excluding timer pauses and recording gaps. Original elapsed time is retained in the data.
- Missing GPS samples, time going backwards, and intervals over two minutes
  split the line so it does not imply a route across missing data.
- Indoor/no-GPS recordings are skipped. Damaged, empty, and stationary recordings produce clear errors.
- Local files are decoded sequentially in a browser Web Worker, not uploaded or persisted. This avoids Vercel request/response size limits and keeps decoding off the main UI thread. Reloading clears the track.
- Map tiles need internet access and are requested directly from OpenStreetMap;
  the full FIT file is not sent to the tile provider.
- Intervals.icu can import the latest 100 activities with read-only access. Activities without GPS and unavailable Strava-only stubs are skipped and explained; there is no ride picker.

## Intervals.icu API-key access

Users paste their personal API key from Intervals.icu Settings → Developer Settings and select Import latest 100. The key is sent in an HTTPS request body to our server, used for Basic authentication with Intervals.icu, and is not logged or persisted. The form clears immediately. Athlete ID 0 identifies the key owner, so no athlete ID is needed. No OAuth app or environment variables are required for this version.

## Parked OAuth setup (future version)

OAuth UI/lifecycle and configuration are commented out; routes and encrypted-session code are retained. Restore those blocks and the OAuth import authentication branch when re-enabling.


The connection is configuration-gated. The app works without these values, but the Connect button remains disabled.

1. [Register an Intervals.icu OAuth application](https://intervals.icu/oauth/apply). A new application remains pending and cannot complete OAuth until Intervals.icu approves it.
2. Add callback URLs in the Intervals.icu app manager. For local development use `http://localhost:3000/api/intervals/callback`; production must use the same path on the deployed HTTPS origin.
3. Copy `.env.example` to `.env.local` and supply `INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET`, `INTERVALS_REDIRECT_URI`, and a stable random `INTERVALS_SESSION_SECRET` of at least 32 characters. Add the same values as server-side environment variables in Vercel, using the production callback URL there.
4. Restart the development server after changing environment variables.

The OAuth request asks only for `ACTIVITY:READ`. The client secret and plaintext access token stay in server code. The access token is stored in an authenticated, encrypted, HttpOnly, SameSite cookie so it works across Vercel function instances; browser JavaScript and local storage cannot read it. Keep `INTERVALS_SESSION_SECRET` stable and private, because changing it disconnects existing sessions. **Disconnect** asks Intervals.icu to revoke the token and clears the cookie.

After connection, RideMapClip requests the newest 100 summaries, downloads Intervals.icu-generated FIT files with at most three concurrent requests, and feeds them through the existing FIT parser. HTTP 429 responses honor `Retry-After` with bounded retries; the code does not assume a fixed quota because the app owner manages limits in the Intervals.icu dashboard. The importer streams progress and per-activity skip reasons back to the page instead of loading an athlete's whole history.

Reference: [Intervals.icu OAuth](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759), [API integration cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090), and [API documentation](https://intervals.icu/api-docs.html).

## Animation and fixed clip duration

Select **Play animation** to reveal the track with one moving rider marker per track. All tracks start together. The longest moving duration maps to 30 seconds; shorter rides finish proportionally earlier and remain visible. For example, a one-hour ride finishes at 15 seconds alongside a two-hour ride. Missing durations use the full 30 seconds, with a notice.
Every clip is fixed at **30 seconds**, for the whole clip, regardless of ride distance. Movement follows GPS distance at a steady pace, not the original ride's
speed. Missing GPS sections remain disconnected. Use Pause/Resume, Restart, or
Replay; leaving the tab pauses playback. Animation starts only when requested. The Fullscreen button expands the map and playback controls together; use Exit fullscreen or Escape to return.

`lib/clip.ts` owns the duration rule. Future video exports must use that same
30-second duration. There are no speed or duration settings until the user
explicitly requests them. Create video renders 900 frames into a 30-second 1920×1080 H.264 MP4 in your browser. Position the map first; the view is captured when rendering begins. The result plays in-browser and can be downloaded. Chrome/Edge with H.264 WebCodecs encoding are supported; unsupported browsers show an error. Cancel stops rendering. Only loaded map tiles are captured, with OpenStreetMap attribution included. The video stays in browser memory until downloaded or the page is closed. Rendering speed depends on the computer and number of rides.

The final glow fades before each ride finishes, including inside the final 30-second boundary.

## Validation

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

The tests generate binary FIT fixtures using Garmin's encoder and check coordinate
conversion, timestamps, distance, integrity failures, missing GPS, dateline
crossings, and upload errors and limits. Real-device testing remains useful
because device exports vary.

## Main files

- `lib/parse-fit.ts`: FIT decoding and normalization.
- `lib/track.ts`: independent track model and geometry helpers.
- `lib/read-fit-files.ts` and `lib/fit.worker.ts`: local file processing and progress, using the shared FIT parser.
- `app/api/upload/route.ts`: legacy server upload endpoint; the file picker no longer uses it.
- `lib/intervals.ts` and `lib/intervals-session.ts`: bounded Intervals.icu requests and encrypted OAuth sessions.
- `app/api/intervals/`: OAuth connection, status, revocation and streaming activity import.
- `app/track-map.tsx`: client-only map, markers, and cleanup.
- `app/page.tsx`: multi-file workflow.

The background map is for interactive local previews. Review the tile provider
and its usage terms before public deployment or automated video rendering.

Browser export tests: run npm.cmd run build, then npm.cmd run test:browser (Microsoft Edge required). These exercise map positioning, mid-render cancellation, MP4 playback/download and a large group export.

