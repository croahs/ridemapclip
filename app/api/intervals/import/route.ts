import { gunzipSync } from "node:zlib";
import { type NextRequest } from "next/server";
import { MAX_FIT_BYTES } from "@/lib/fit";
import {
  activityFitUrl,
  activityListUrl,
  activityName,
  INTERVALS_DOWNLOAD_CONCURRENCY,
  mapWithConcurrency,
  retryAfterMs,
  type IntervalsActivity,
  usableActivity,
} from "@/lib/intervals";
import { FitError, NoGpsFitError, parseFit } from "@/lib/parse-fit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIST_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = MAX_FIT_BYTES + 5 * 1024 * 1024;

async function fetchIntervals(url: string, authorization: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 429 || attempt === 2) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, retryAfterMs(response.headers.get("retry-after"))));
  }
  throw new Error("Intervals.icu request failed.");
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new FitError("The downloaded activity is too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new FitError("Intervals.icu returned an empty activity file.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new FitError("The downloaded activity is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function fitArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  let decoded = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      decoded = new Uint8Array(gunzipSync(bytes, { maxOutputLength: MAX_FIT_BYTES }));
    } catch {
      throw new FitError("The downloaded activity could not be decompressed as a FIT file.");
    }
  }
  if (decoded.byteLength > MAX_FIT_BYTES) throw new FitError("The downloaded FIT file is larger than 20 MB.");
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return Response.json({ error: "Import must be started from this website." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Enter your Intervals.icu API key." }, { status: 400 });
  }
  let apiKey: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1024) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    apiKey = JSON.parse(Buffer.concat(chunks).toString("utf8")).apiKey;
  } catch {
    return Response.json({ error: "Enter a valid Intervals.icu API key." }, { status: 400 });
  }
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{1,256}$/.test(apiKey)) {
    return Response.json({ error: "Enter a valid Intervals.icu API key." }, { status: 400 });
  }
  const authorization = "Basic " + Buffer.from("API_KEY:" + apiKey).toString("base64");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      try {
        const listResponse = await fetchIntervals(activityListUrl(), authorization);
        if (listResponse.status === 401 || listResponse.status === 403) throw new Error("Intervals.icu rejected this API key. Check the key in Developer Settings and try again.");
        if (listResponse.status === 429) throw new Error("Intervals.icu is busy. Wait a moment and try the import again.");
        if (!listResponse.ok) throw new Error(`Intervals.icu could not list activities (${listResponse.status}).`);
        const listBytes = await readLimited(listResponse, MAX_LIST_BYTES);
        const parsed = JSON.parse(new TextDecoder().decode(listBytes));
        if (!Array.isArray(parsed)) throw new Error("Intervals.icu returned an unexpected activity list.");
        const activities = (parsed as IntervalsActivity[]).filter(usableActivity);
        const stubCount = parsed.length - activities.length;
        send({ type: "start", total: activities.length, listed: parsed.length, stubCount });
        let completed = 0;
        let imported = 0;
        let skipped = stubCount;

        await mapWithConcurrency(activities, INTERVALS_DOWNLOAD_CONCURRENCY, async (activity, index) => {
          const name = activityName(activity);
          try {
            const response = await fetchIntervals(activityFitUrl(activity.id), authorization);
            if (response.status === 429) throw new Error("Rate limit remained active after retries.");
            if (!response.ok) throw new Error(`FIT download returned ${response.status}.`);
            const bytes = await readLimited(response, MAX_DOWNLOAD_BYTES);
            const track = parseFit(fitArrayBuffer(bytes), name);
            imported++;
            send({ type: "track", index, track });
          } catch (error) {
            skipped++;
            const reason = error instanceof NoGpsFitError
              ? "No usable GPS route."
              : error instanceof FitError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "The activity could not be imported.";
            send({ type: "skip", index, message: `${name}: ${reason}` });
          } finally {
            completed++;
            send({ type: "progress", completed, total: activities.length, imported, skipped });
          }
        });
        send({ type: "done", total: activities.length, imported, skipped });
      } catch (error) {
        const message = error instanceof SyntaxError
          ? "Intervals.icu returned an unreadable activity list."
          : error instanceof Error ? error.message : "The Intervals.icu import failed.";
        send({ type: "fatal", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
