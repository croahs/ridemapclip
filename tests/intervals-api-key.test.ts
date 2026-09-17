import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { Encoder, Profile, type FileIdMesg, type RecordMesg } from "@garmin/fitsdk";
import { POST } from "../app/api/intervals/import/route";

const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/intervals/import", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

test("API-key import rejects missing credentials, oversized bodies and foreign origins", async () => {
  assert.equal((await POST(request({}))).status, 400);
  assert.equal((await POST(request({ apiKey: "x".repeat(2000) }))).status, 400);
  assert.equal((await POST(request({ apiKey: "test-key" }, "https://foreign.example"))).status, 403);
});

test("API-key import uses Basic auth, requests latest 100 and reuses FIT parsing without OAuth", async () => {
  const original = globalThis.fetch; const urls: URL[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Basic " + Buffer.from("API_KEY:test-key").toString("base64"));
    if (url.pathname.endsWith("/activities")) return Response.json([{ id: "i123", name: "Test ride", type: "Ride" }, { id: "123", source: "STRAVA" }]);
    const encoder = new Encoder();
    encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", timeCreated: new Date() } as FileIdMesg);
    for (const latitude of [48, 48.01]) encoder.onMesg(Profile.MesgNum.RECORD, { positionLat: Math.round(latitude * 2 ** 31 / 180), positionLong: Math.round(2 * 2 ** 31 / 180) } as RecordMesg);
    return new Response(new Uint8Array(encoder.close()));
  };
  try {
    const response = await POST(request({ apiKey: "test-key" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
    const text = await response.text();
    const events = text.trim().split("\n").map(line => JSON.parse(line));
    assert.equal(urls[0].searchParams.get("limit"), "100");
    assert.equal(urls[0].pathname, "/api/v1/athlete/0/activities");
    assert.equal(events.find(event => event.type === "start").stubCount, 1);
    assert.ok(events.find(event => event.type === "track").track.points.length > 1);
    assert.equal(events.at(-1).imported, 1);
    assert.ok(!text.includes("test-key"));
  } finally { globalThis.fetch = original; }
});

test("invalid API keys produce an actionable error without echoing credentials", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });
  try {
    const response = await POST(request({ apiKey: "test-key" }));
    const text = await response.text();
    assert.match(text, /rejected this API key/);
    assert.ok(!text.includes("test-key"));
  } finally { globalThis.fetch = original; }
});
