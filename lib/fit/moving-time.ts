import { distanceBetween } from "../track";
import type { TrackPoint } from "./types";

type TimerEvent = { timestamp?: unknown; event?: unknown; eventType?: unknown };
type Session = { totalMovingTime?: unknown };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Prefer device moving time; otherwise integrate moving samples with the timer running. */
export function movingTime(points: TrackPoint[], speeds: (number | null)[], events: TimerEvent[], sessions: Session[]): { seconds: number | null; estimated: boolean } {
  if (sessions.length && sessions.every(session => positive(session.totalMovingTime))) {
    return { seconds: sessions.reduce((sum, session) => sum + (session.totalMovingTime as number), 0), estimated: false };
  }
  const changes = events.flatMap(event => {
    const time = event.timestamp instanceof Date ? event.timestamp.getTime() : NaN;
    if (event.event !== "timer" || !Number.isFinite(time)) return [];
    if (event.eventType === "start") return [{ time, active: true }];
    if (["stop", "stopAll", "stopDisable", "stopDisableAll"].includes(String(event.eventType))) return [{ time, active: false }];
    return [];
  }).sort((a, b) => a.time - b.time);
  let eventIndex = 0;
  let active = true;
  let seconds = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const start = previous.timestamp === null ? NaN : Date.parse(previous.timestamp);
    const end = current.timestamp === null ? NaN : Date.parse(current.timestamp);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 120000 || current.breakBefore) continue;
    while (eventIndex < changes.length && changes[eventIndex].time <= start) active = changes[eventIndex++].active;
    let cursor = start;
    let activeMs = 0;
    while (eventIndex < changes.length && changes[eventIndex].time < end) {
      const change = changes[eventIndex++];
      if (active) activeMs += change.time - cursor;
      cursor = change.time;
      active = change.active;
    }
    if (active) activeMs += end - cursor;
    // A 0.5 m/s threshold avoids counting stationary GPS drift as cycling.
    const speed = speeds[i] ?? distanceBetween(previous, current) / ((end - start) / 1000);
    if (speed >= 0.5) seconds += activeMs / 1000;
  }
  return { seconds: seconds > 0 ? seconds : null, estimated: true };
}
