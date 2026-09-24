import { MAX_FIT_BYTES } from "./fit/limits";
import type { FitWorkerResult } from "./fit/types";
import type { Track } from "./track";

const API_BASE = "https://intervals.icu/api";

export const INTERVALS_IMPORT_LIMIT = 100;
export const INTERVALS_DOWNLOAD_CONCURRENCY = 3;

export type IntervalsActivity = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  start_date_local?: unknown;
  file_type?: unknown;
  source?: unknown;
};

export function activityListUrl(): string {
  const url = new URL(`${API_BASE}/v1/athlete/0/activities`);
  url.searchParams.set("oldest", "1970-01-01");
  url.searchParams.set("limit", String(INTERVALS_IMPORT_LIMIT));
  url.searchParams.set("fields", "id,name,type,start_date_local,file_type,source");
  return url.toString();
}

export function usableActivity(activity: IntervalsActivity): activity is IntervalsActivity & { id: string } {
  return typeof activity.id === "string" && /^i\d+$/.test(activity.id);
}

export function activityName(activity: IntervalsActivity & { id: string }): string {
  const title = typeof activity.name === "string" && activity.name.trim()
    ? activity.name.trim()
    : typeof activity.type === "string" && activity.type.trim()
      ? activity.type.trim()
      : "Intervals.icu activity";
  const date = typeof activity.start_date_local === "string" ? activity.start_date_local.slice(0, 10) : "";
  return date ? `${title} · ${date}` : title;
}

export function activityFitUrl(id: string): string {
  if (!/^i\d+$/.test(id)) throw new Error("Invalid Intervals.icu activity ID.");
  return `${API_BASE}/v1/activity/${id}/fit-file`;
}

export function retryAfterMs(value: string | null, nowMs = Date.now()): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - nowMs)) : 1_000;
}

export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run));
}

const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = MAX_FIT_BYTES + 5 * 1024 * 1024;

export type ImportProgress = { completed: number; total: number; imported: number; skipped: number };
type ParseFit = (buffer: ArrayBuffer, name: string) => Promise<FitWorkerResult>;

export function validApiKey(apiKey: string): boolean {
  return /^[\x21-\x7e]{1,256}$/.test(apiKey);
}

async function fetchIntervals(url: string, authorization: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { Authorization: authorization }, cache: "no-store", signal });
    if (response.status !== 429 || attempt === 2) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, retryAfterMs(response.headers.get("retry-after"))));
  }
}

async function readLimited(response: Response, limit: number, tooLarge: string): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(tooLarge);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Intervals.icu returned an empty response.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Intervals.icu may serve FIT files gzip-compressed. */
async function fitBuffer(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return (await readLimited(new Response(stream), MAX_FIT_BYTES, "The downloaded FIT file is larger than 20 MB.")).buffer;
  } catch (error) {
    if (error instanceof Error && error.message.includes("20 MB")) throw error;
    throw new Error("The downloaded activity could not be decompressed as a FIT file.", { cause: error });
  }
}

/**
 * Imports the latest activities straight from Intervals.icu in the browser.
 * The API key is sent only to Intervals.icu and never stored.
 */
export async function importLatestActivities(apiKey: string, parse: ParseFit, onProgress: (progress: ImportProgress) => void, signal?: AbortSignal) {
  if (!validApiKey(apiKey)) throw new Error("Enter a valid Intervals.icu API key.");
  const authorization = "Basic " + btoa("API_KEY:" + apiKey);
  let listResponse: Response;
  try {
    listResponse = await fetchIntervals(activityListUrl(), authorization, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Intervals.icu could not be reached. Check your connection and try again.", { cause: error });
  }
  if (listResponse.status === 401 || listResponse.status === 403) throw new Error("Intervals.icu rejected this API key. Check the key in Developer Settings and try again.");
  if (listResponse.status === 429) throw new Error("Intervals.icu is busy. Wait a moment and try the import again.");
  if (!listResponse.ok) throw new Error(`Intervals.icu could not list activities (${listResponse.status}).`);
  let listed: unknown;
  try {
    listed = JSON.parse(new TextDecoder().decode(await readLimited(listResponse, MAX_LIST_BYTES, "The Intervals.icu activity list is too large.")));
  } catch (error) {
    throw error instanceof SyntaxError ? new Error("Intervals.icu returned an unreadable activity list.") : error;
  }
  if (!Array.isArray(listed)) throw new Error("Intervals.icu returned an unexpected activity list.");
  const activities = (listed as IntervalsActivity[]).filter(usableActivity);
  const stubCount = listed.length - activities.length;
  const skipped: string[] = stubCount ? [`${stubCount} Strava-only activit${stubCount === 1 ? "y was" : "ies were"} unavailable to connected apps.`] : [];
  const tracks: (Track | undefined)[] = [];
  const progress: ImportProgress = { completed: 0, total: activities.length, imported: 0, skipped: stubCount };
  onProgress({ ...progress });

  await mapWithConcurrency(activities, INTERVALS_DOWNLOAD_CONCURRENCY, async (activity, index) => {
    const name = activityName(activity);
    try {
      const response = await fetchIntervals(activityFitUrl(activity.id), authorization, signal);
      if (response.status === 429) throw new Error("Rate limit remained active after retries.");
      if (!response.ok) throw new Error(`FIT download returned ${response.status}.`);
      const result = await parse(await fitBuffer(await readLimited(response, MAX_DOWNLOAD_BYTES, "The downloaded activity is too large.")), name);
      if (result.kind !== "track") throw new Error(result.message);
      tracks[index] = result.track;
      progress.imported++;
    } catch (error) {
      signal?.throwIfAborted();
      progress.skipped++;
      const message = error instanceof Error ? error.message : "The activity could not be imported.";
      skipped.push(message.startsWith(name + ": ") ? message : `${name}: ${message}`);
    } finally {
      progress.completed++;
      onProgress({ ...progress });
    }
  });
  return { tracks: tracks.filter((track): track is Track => track !== undefined), skipped };
}
