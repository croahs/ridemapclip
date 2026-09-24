import assert from "node:assert/strict";
import { test } from "node:test";
import { Encoder, Profile, type FileIdMesg } from "@garmin/fitsdk";
import { parseFit, readFit } from "../lib/fit/parse";
import { MAX_FIT_BYTES, MAX_BATCH_BYTES, validateFitBatch, validateFitFile } from "../lib/fit/limits";
import { createPlaybackRoute } from "../lib/clip/playback";

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
  assert.equal(createPlaybackRoute(track.points).breaks.filter(Boolean).length + 1, 3);
});

test("missing timestamps remain missing and do not become fabricated dates", () => {
  const track = parseFit(recording([{ positionLat: 0, positionLong: 0 }, { positionLat: semicircles(0.001), positionLong: 0 }]), "untimed.fit");
  assert.equal(track.elapsedSeconds, null);
  assert.equal(track.points[0].timestamp, null);
  assert.ok(track.warnings.some((warning) => warning.includes("timestamp")));
});

test("dateline crossings stay local in the map and distance calculation", () => {
  const track = parseFit(recording([point(0, 179.999, 0), point(0, -179.999, 10)]), "dateline.fit");
  const [start, end] = createPlaybackRoute(track.points).coordinates;
  assert.ok(Math.abs(end[1] - start[1]) < 0.003);
  assert.ok(track.distanceMeters > 220 && track.distanceMeters < 225);
});

test("batch validation rejects empty, oversized, non-FIT and too many files", () => {
  const fit = (name: string, size = 1000) => ({ name, size });
  assert.equal(validateFitBatch([fit("ride.FIT")]), null);
  assert.match(validateFitBatch([])!, /between 1 and 200/);
  assert.match(validateFitBatch(Array.from({ length: 201 }, (_, i) => fit(`ride-${i}.fit`)))!, /between 1 and 200/);
  assert.match(validateFitBatch([fit("empty.fit", 0)])!, /empty.fit: .*empty/);
  assert.match(validateFitBatch([fit("ride.txt")])!, /ride.txt/);
  assert.match(validateFitFile({ name: "large.fit", size: MAX_FIT_BYTES + 1 })!, /too large/);
  assert.match(validateFitBatch(Array.from({ length: 30 }, (_, i) => fit(`ride-${i}.fit`, MAX_FIT_BYTES)))!, /500 MB/);
  assert.ok(30 * MAX_FIT_BYTES > MAX_BATCH_BYTES);
});

test("readFit returns tracks, names GPS-less skips and names damaged files", () => {
  const good = readFit(ride(), "good.fit");
  assert.equal(good.kind, "track");
  assert.equal(good.kind === "track" && good.track.name, "good.fit");
  for (const [data, name] of [[recording([{ timestamp: start, heartRate: 120 }]), "indoor.fit"], [recording([point(48, 2, 0)]), "single.fit"]] as const) {
    const result = readFit(data, name);
    assert.equal(result.kind, "skipped");
    assert.match(result.kind === "skipped" ? result.message : "", new RegExp(name));
  }
  const broken = readFit(new TextEncoder().encode("not a real FIT recording").buffer, "broken.fit");
  assert.equal(broken.kind, "error");
  assert.match(broken.kind === "error" ? broken.message : "", /^broken.fit: /);
});
