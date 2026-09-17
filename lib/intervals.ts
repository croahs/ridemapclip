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
