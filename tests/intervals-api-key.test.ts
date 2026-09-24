import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { Encoder, Profile, type FileIdMesg, type RecordMesg } from "@garmin/fitsdk";
import { importLatestActivities, type ImportProgress } from "../lib/intervals";
import { readFit } from "../lib/fit/parse";

const parse = async (buffer: ArrayBuffer, name: string) => readFit(buffer, name);

function fit(latitudes: number[]) {
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", timeCreated: new Date() } as FileIdMesg);
  for (const latitude of latitudes) encoder.onMesg(Profile.MesgNum.RECORD, { positionLat: Math.round(latitude * 2 ** 31 / 180), positionLong: Math.round(2 * 2 ** 31 / 180) } as RecordMesg);
  return new Uint8Array(encoder.close());
}

async function withFetch<T>(handler: (url: URL, init?: RequestInit) => Response, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(new URL(String(input)), init);
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("rejects malformed keys before any request", async () => {
  await withFetch(() => assert.fail("no request expected"), async () => {
    await assert.rejects(importLatestActivities("", parse, () => {}), /valid Intervals.icu API key/);
    await assert.rejects(importLatestActivities("x".repeat(257), parse, () => {}), /valid Intervals.icu API key/);
    await assert.rejects(importLatestActivities("with space", parse, () => {}), /valid Intervals.icu API key/);
  });
});

test("uses Basic auth, requests the latest 100, keeps order and explains skips", async () => {
  const urls: URL[] = [];
  const progress: ImportProgress[] = [];
  const result = await withFetch((url, init) => {
    urls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Basic " + Buffer.from("API_KEY:test-key").toString("base64"));
    if (url.pathname.endsWith("/activities")) return Response.json([
      { id: "i1", name: "First" }, { id: "123", source: "STRAVA" }, { id: "i2", name: "Indoor" }, { id: "i3", name: "Gzipped" },
    ]);
    if (url.pathname.includes("/i1/")) return new Response(fit([48, 48.01]));
    if (url.pathname.includes("/i2/")) return new Response(fit([]));
    return new Response(gzipSync(fit([49, 49.01])));
  }, () => importLatestActivities("test-key", parse, value => progress.push(value)));
  assert.equal(urls[0].pathname, "/api/v1/athlete/0/activities");
  assert.equal(urls[0].searchParams.get("limit"), "100");
  assert.deepEqual(result.tracks.map(track => track.name), ["First", "Gzipped"]);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0], /1 Strava-only activity was unavailable/);
  assert.match(result.skipped[1], /^Indoor: .*fewer than two GPS points/);
  assert.deepEqual(progress.at(-1), { completed: 3, total: 3, imported: 2, skipped: 2 });
});

test("rejected keys produce an actionable error without echoing the key", async () => {
  await withFetch(() => new Response(null, { status: 401 }), async () => {
    const error = await importLatestActivities("test-key", parse, () => {}).catch((failure: Error) => failure);
    assert.match(String(error), /rejected this API key/);
    assert.ok(!String(error).includes("test-key"));
  });
});

test("network failures on the activity list explain the connection problem", async () => {
  await withFetch(() => { throw new TypeError("Failed to fetch"); }, async () => {
    await assert.rejects(importLatestActivities("test-key", parse, () => {}), /could not be reached/);
  });
});
