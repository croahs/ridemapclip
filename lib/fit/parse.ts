import { Decoder, Stream } from "@garmin/fitsdk";
import { MAX_FIT_BYTES } from "./limits";
import { distanceBetween, type Track } from "../track";

import { movingTime } from "./moving-time";
import type { FitWorkerResult, TrackPoint } from "./types";

export class FitError extends Error {}
export class NoGpsFitError extends FitError {}

const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;
const MAX_TRACK_POINTS = 200_000;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseFit(buffer: ArrayBuffer, name: string): Track {
  if (buffer.byteLength > MAX_FIT_BYTES) throw new FitError("This FIT file is too large.");
  if (buffer.byteLength < 14) throw new FitError("This is not a complete FIT file. Export it again from your device.");

  let decoded: ReturnType<Decoder["read"]>;
  try {
    const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
    if (!decoder.isFIT()) throw new FitError("This file is not a FIT recording. Renaming a file to .fit will not convert it.");
    if (!decoder.checkIntegrity()) throw new FitError("This FIT file is incomplete or damaged. Please export it again.");
    decoded = decoder.read({ applyScaleAndOffset: true, convertDateTimesToDates: true });
  } catch (error) {
    if (error instanceof FitError) throw error;
    throw new FitError("This FIT file could not be read. Please export it again from your device.");
  }
  if (decoded.errors.length) throw new FitError("This FIT file contains unreadable data. Please export it again.");

  const points: TrackPoint[] = [];
  const speeds: (number | null)[] = [];
  let skippedRecords = 0;
  let breakNext = false;
  let gaps = 0;
  let distanceMeters = 0;
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const record of decoded.messages.recordMesgs ?? []) {
    const latitude = finiteNumber(record.positionLat) ? record.positionLat * SEMICIRCLES_TO_DEGREES : NaN;
    const longitude = finiteNumber(record.positionLong) ? record.positionLong * SEMICIRCLES_TO_DEGREES : NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
        record.positionLat === 0x7fffffff || record.positionLong === 0x7fffffff) {
      skippedRecords++;
      breakNext = true;
      continue;
    }
    if (points.length >= MAX_TRACK_POINTS) throw new FitError("This recording has more than 200,000 GPS points. Please export a shorter ride.");
    const time = record.timestamp instanceof Date && Number.isFinite(record.timestamp.getTime())
      ? record.timestamp.getTime() : null;
    const previous = points.at(-1);
    const previousTime = previous?.timestamp ? Date.parse(previous.timestamp) : null;
    const timeGap = time !== null && previousTime !== null && (time - previousTime > 120_000 || time < previousTime);
    const breakBefore = Boolean(previous && (breakNext || timeGap));
    if (breakBefore) gaps++;
    const point: TrackPoint = {
      latitude, longitude,
      timestamp: time === null ? null : new Date(time).toISOString(),
      breakBefore,
    };
    if (previous && !breakBefore) distanceMeters += distanceBetween(previous, point);
    if (time !== null) {
      earliest = earliest === null ? time : Math.min(earliest, time);
      latest = latest === null ? time : Math.max(latest, time);
    }
    points.push(point);
    const speed = finiteNumber(record.enhancedSpeed) ? record.enhancedSpeed : record.speed;
    speeds.push(finiteNumber(speed) && speed >= 0 ? speed : null);
    breakNext = false;
  }
  if (points.length < 2) throw new NoGpsFitError("This FIT file has fewer than two GPS points. Indoor rides and recordings without GPS cannot make a track.");
  const first = points[0];
  if (!points.some((point) => point.latitude !== first.latitude || point.longitude !== first.longitude)) {
    throw new FitError("This recording contains only one GPS location. A track needs at least two different locations.");
  }
  const warnings: string[] = [];
  if (skippedRecords) warnings.push(`${skippedRecords.toLocaleString("en-US")} records without usable GPS coordinates were skipped.`);
  if (gaps) warnings.push(`${gaps} recording gap(s) are shown as separate track sections. GPS distance excludes these gaps.`);
  if (points.some((point) => point.timestamp === null)) warnings.push("Some GPS points have no timestamp; timed playback may be limited.");
  const moving = movingTime(points, speeds, decoded.messages.eventMesgs ?? [], decoded.messages.sessionMesgs ?? []);
  if (moving.estimated && moving.seconds !== null) warnings.push("Moving time estimated from recorded speed or GPS movement, excluding timer pauses and recording gaps.");
  if (moving.seconds === null) warnings.push("Moving time could not be determined; this ride uses the full clip length.");
  return {
    movingSeconds: moving.seconds,
    name, distanceMeters, skippedRecords, warnings,
    path: {
      latitudes: Float64Array.from(points, point => point.latitude),
      longitudes: Float64Array.from(points, point => point.longitude),
      breaks: Uint8Array.from(points, point => point.breakBefore ? 1 : 0),
    },
    elapsedSeconds: earliest !== null && latest !== null && latest > earliest ? (latest - earliest) / 1000 : null,
    startedAt: earliest === null ? null : new Date(earliest).toISOString(),
    endedAt: latest === null ? null : new Date(latest).toISOString(),
  };
}

/** Classifies one recording: a track, a GPS-less skip, or a named failure. */
export function readFit(buffer: ArrayBuffer, name: string): FitWorkerResult {
  try {
    return { kind: "track", track: parseFit(buffer, name) };
  } catch (error) {
    const message = name + ": " + (error instanceof FitError ? error.message : "This recording could not be read. Please export it again.");
    return { kind: error instanceof NoGpsFitError ? "skipped" : "error", message };
  }
}
