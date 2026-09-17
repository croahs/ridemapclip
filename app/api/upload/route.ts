import { NextResponse } from "next/server";
import { MAX_BATCH_BYTES, validateFitBatch } from "@/lib/fit";
import { FitError, NoGpsFitError, parseFit } from "@/lib/parse-fit";

export const runtime = "nodejs";
const MAX_BODY_BYTES = MAX_BATCH_BYTES + 64 * 1024;

// Bound the actual body, including uploads without a Content-Length header.
async function readForm(request: Request): Promise<FormData> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw new FitError("Please upload up to 200 FIT files using the file picker.");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new FitError("This upload is too large. Maximum batch size is 500 MB (20 MB per file).");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new FitError("Please choose up to 200 FIT files.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FitError("This upload is too large. Maximum batch size is 500 MB (20 MB per file).");
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    throw new FitError("The upload could not be read. Please select your FIT file and try again.");
  }
}

export async function POST(request: Request) {
  try {
    const form = await readForm(request);
    const entries = form.getAll("files");
    if (!entries.every((entry): entry is File => entry instanceof File)) {
      throw new FitError("Please choose FIT files using the file picker.");
    }
    const error = validateFitBatch(entries);
    if (error) throw new FitError(error);
    const tracks = [];
    const skipped: string[] = [];
    for (const file of entries) {
      try {
        tracks.push(parseFit(await file.arrayBuffer(), file.name));
      } catch (error) {
        if (error instanceof NoGpsFitError) {
          skipped.push(file.name + ": " + error.message);
          continue;
        }
        if (error instanceof FitError) throw new FitError(file.name + ": " + error.message);
        throw error;
      }
    }
    return NextResponse.json({ ok: true, tracks, skipped }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FitError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("FIT upload failed", error);
    return NextResponse.json({ ok: false, error: "The track could not be created. Please try again." }, { status: 500 });
  }
}
