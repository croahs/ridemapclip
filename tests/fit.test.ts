import assert from "node:assert/strict";
import { test } from "node:test";
import { Encoder, Profile, type FileIdMesg } from "@garmin/fitsdk";
import { parseFit } from "../lib/parse-fit";
import { MAX_FIT_BYTES, MAX_BATCH_BYTES, validateFitFile } from "../lib/fit";
import { mapSegments } from "../lib/track";
import { POST } from "../app/api/upload/route";

const start = new Date("2026-09-15T08:00:00Z");
const semicircles = (degrees: number) => Math.round(degrees * 2 ** 31 / 180);

function recording(records: Record<string, unknown>[]): ArrayBuffer {
  const encoder = new Encoder();
  const fileId: FileIdMesg = { type: "activity", manufacturer: "development", timeCreated: start };
  encoder.onMesg(Profile.MesgNum.FILE_ID, fileId);
  for (const record of records) encoder.onMesg(Profile.MesgNum.RECORD, record);
  return new Uint8Array(encoder.close()).buffer;
}

function point(latitude: number, longitude: number, seconds: number) {
  return { positionLat: semicircles(latitude), positionLong: semicircles(longitude), timestamp: new Date(start.getTime() + seconds * 1000), altitude: 125 };
}

const ride = () => recording([point(48.85, 2.35, 0), point(48.851, 2.35, 10), point(48.852, 2.35, 20)]);

function request(files: { data: ArrayBuffer; name: string }[]) {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.data], file.name));
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}

test("decodes a binary FIT ride into accurate coordinates, meters and times", () => {
  const track = parseFit(ride(), "ride.fit");
  assert.equal(track.points.length, 3);
  assert.ok(Math.abs(track.points[0].latitude - 48.85) < 0.000001);
  assert.ok(Math.abs(track.points[0].longitude - 2.35) < 0.000001);
  assert.equal(track.points[0].elevationMeters, 125);
  assert.equal(track.startedAt, start.toISOString());
  assert.equal(track.elapsedSeconds, 20);
  assert.ok(track.distanceMeters > 222 && track.distanceMeters < 223);
  assert.equal(track.movingSeconds, 20);
  assert.ok(track.warnings.some(warning => warning.includes("Moving time estimated")));
});

test("rejects a renamed text file, truncation and CRC corruption", () => {
  assert.throws(() => parseFit(new TextEncoder().encode("this is not a FIT recording").buffer, "fake.fit"), /not a FIT recording/);
  assert.throws(() => parseFit(ride().slice(0, -4), "truncated.fit"), /damaged/);
  const bad = new Uint8Array(ride());
  bad[bad.length - 1] ^= 0xff;
  assert.throws(() => parseFit(bad.buffer, "bad.fit"), /damaged/);
});

test("indoor, single-point and stationary recordings do not produce a fake track", () => {
  assert.throws(() => parseFit(recording([{ timestamp: start, heartRate: 120 }]), "indoor.fit"), /fewer than two GPS/);
  assert.throws(() => parseFit(recording([point(48, 2, 0)]), "one.fit"), /fewer than two GPS/);
  assert.throws(() => parseFit(recording([point(48, 2, 0), point(48, 2, 10)]), "stationary.fit"), /one GPS location/);
});

test("keeps zero coordinates and southern and western hemisphere coordinates", () => {
  const track = parseFit(recording([point(0, 0, 0), point(-0.001, -0.001, 10)]), "equator.fit");
  assert.equal(track.points[0].latitude, 0);
  assert.equal(track.points[0].longitude, 0);
  assert.ok(track.points[1].latitude < 0 && track.points[1].longitude < 0);
});

test("missing GPS and long gaps split the track and exclude invented distance", () => {
  const track = parseFit(recording([point(48, 2, 0), { timestamp: start, heartRate: 120 }, point(49, 3, 10), point(50, 4, 600)]), "gaps.fit");
  assert.equal(track.skippedRecords, 1);
  assert.deepEqual(track.points.map((p) => p.breakBefore), [false, true, true]);
  assert.equal(track.distanceMeters, 0);
  assert.equal(mapSegments(track.points).length, 3);
});

test("missing timestamps remain missing and do not become fabricated dates", () => {
  const track = parseFit(recording([{ positionLat: 0, positionLong: 0 }, { positionLat: semicircles(0.001), positionLong: 0 }]), "untimed.fit");
  assert.equal(track.elapsedSeconds, null);
  assert.equal(track.points[0].timestamp, null);
  assert.ok(track.warnings.some((warning) => warning.includes("timestamp")));
});

test("dateline crossings stay local in the map and distance calculation", () => {
  const track = parseFit(recording([point(0, 179.999, 0), point(0, -179.999, 10)]), "dateline.fit");
  const segment = mapSegments(track.points)[0];
  assert.ok(Math.abs(segment[1][1] - segment[0][1]) < 0.003);
  assert.ok(track.distanceMeters > 220 && track.distanceMeters < 225);
});

test("upload returns a parsed track and does not cache location data", async () => {
  const response = await POST(request([{ data: ride(), name: "ride.FIT" }]));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).tracks[0].points.length, 3);
});

test("upload rejects missing, multiple, empty, non-FIT and malformed uploads", async () => {
  for (const files of [[], Array.from({ length: 201 }, (_, i) => ({ data: ride(), name: `ride-${i}.fit` })), [{ data: new ArrayBuffer(0), name: "empty.fit" }], [{ data: ride(), name: "ride.txt" }]]) {
    assert.equal((await POST(request(files))).status, 400);
  }
  const malformed = new Request("http://localhost/api/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=bad" }, body: "broken" });
  assert.equal((await POST(malformed)).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/upload", { method: "POST", body: "not multipart" }))).status, 400);
});

test("rejects oversized files and request bodies without Content-Length", async () => {
  assert.match(validateFitFile({ name: "large.fit", size: MAX_FIT_BYTES + 1 })!, /too large/);
  const chunk = new Uint8Array(64 * 1024);
  let enqueued = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (enqueued <= MAX_BATCH_BYTES + 70_000) {
        controller.enqueue(chunk);
        enqueued += chunk.byteLength;
      } else {
        controller.close();
      }
    },
  });
  const init: RequestInit & { duplex: string } = {
    method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half",
  };
  const oversized = new Request("http://localhost/api/upload", init);
  assert.equal(oversized.headers.has("content-length"), false);
  const response = await POST(oversized);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /too large/);
});

test("five FIT files return five distinct tracks in selection order", async () => {
  const response = await POST(request(Array.from({ length: 5 }, (_, i) => ({ data: recording([point(48 + i, 2, 0), point(48.001 + i, 2, 10)]), name: "ride-" + i + ".fit" }))));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.tracks.length, 5);
  result.tracks.forEach((track: { name: string; points: { latitude: number }[] }, i: number) => {
    assert.equal(track.name, "ride-" + i + ".fit");
    assert.ok(Math.abs(track.points[0].latitude - (48 + i)) < 0.000001);
  });
});

test("a damaged file identifies the failing filename without partial success", async () => {
  const response = await POST(request([{ data: ride(), name: "good.fit" }, { data: new TextEncoder().encode("not a real FIT recording").buffer, name: "broken.fit" }]));
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /broken.fit/);
  assert.equal(result.tracks, undefined);
});

test("no-GPS and single-point files are skipped while valid rides retain their order", async () => {
  const response = await POST(request([
    {data: ride(), name: "first.fit"},
    {data: recording([{timestamp: start, heartRate: 120}]), name: "indoor.fit"},
    {data: recording([point(48, 2, 0)]), name: "single.fit"},
    {data: ride(), name: "last.fit"},
  ]));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.deepEqual(result.tracks.map((track: {name: string}) => track.name), ["first.fit", "last.fit"]);
  assert.equal(result.skipped.length, 2);
  assert.match(result.skipped[0], /indoor.fit/);
  assert.match(result.skipped[1], /single.fit/);
});

test("an entirely GPS-less chunk succeeds with an empty track list so later chunks can continue", async () => {
  const response = await POST(request(Array.from({length: 15}, (_, i) => ({data: recording([{timestamp: start, heartRate: 120}]), name: `indoor-${i}.fit`}))));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.deepEqual(result.tracks, []);
  assert.equal(result.skipped.length, 15);
  const next = await POST(request([{data: ride(), name: "outdoor.fit"}]));
  assert.equal((await next.json()).tracks.length, 1);
});
