import { Encoder, Profile, type FileIdMesg, type RecordMesg } from "@garmin/fitsdk";
import type { Page } from "@playwright/test";

const semicircles = (degrees: number) => Math.round(degrees * 2 ** 31 / 180);
const start = new Date("2026-09-15T08:00:00Z");

function encode(records: RecordMesg[], started = start) {
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", timeCreated: started } as FileIdMesg);
  for (const record of records) encoder.onMesg(Profile.MesgNum.RECORD, record);
  return Buffer.from(encoder.close());
}

/** A synthetic loop ride: one GPS point per second, variant shifts size and position. */
export function rideFit(name: string, variant = 0, seconds = 300, started = start, { power = true } = {}) {
  const radius = 0.004 + (variant % 7) * 0.0015;
  const records = Array.from({ length: seconds }, (_, i) => {
    const angle = i / seconds * Math.PI * 2;
    return {
      positionLat: semicircles(58.85 + (variant % 5) * 0.002 + radius * Math.sin(angle)),
      positionLong: semicircles(5.73 + Math.floor(variant / 5) * 0.003 + radius * 2 * Math.cos(angle)),
      timestamp: new Date(started.getTime() + i * 1000),
      altitude: 50 + variant * 10 + 40 * Math.sin(angle * 2),
      ...(power && { power: Math.round(180 + 120 * Math.sin(angle * 3 + variant)) }),
      heartRate: Math.round(130 + 30 * Math.sin(angle * 2 + variant)),
    } as RecordMesg;
  });
  return { name, mimeType: "application/octet-stream", buffer: encode(records, started) };
}

/** A recording without GPS, like an indoor trainer ride. */
export function indoorFit(name: string) {
  const records = Array.from({ length: 10 }, (_, i) => ({ timestamp: new Date(start.getTime() + i * 1000), heartRate: 120 }) as RecordMesg);
  return { name, mimeType: "application/octet-stream", buffer: encode(records) };
}

// 1×1 grey PNG. CORS header keeps the video canvas untainted, as with real tiles.
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==", "base64");

/** Serve map tiles locally so tests are hermetic and do not load OpenStreetMap. */
export async function stubTiles(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({
    contentType: "image/png", body: TILE, headers: { "access-control-allow-origin": "*" },
  }));
}
