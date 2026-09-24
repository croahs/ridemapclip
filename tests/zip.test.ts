import assert from "node:assert/strict";
import { test } from "node:test";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { expandFitInputs, MAX_ZIP_BYTES, MAX_ZIP_ENTRIES } from "../lib/fit/zip";
import { MAX_BATCH_BYTES, MAX_FIT_BYTES } from "../lib/fit/limits";

async function zip(entries: [string, Uint8Array][], options = {}) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, ...options });
  for (const [name, bytes] of entries) await writer.add(name, new Uint8ArrayReader(bytes));
  return new File([await writer.close()], "rides.zip");
}
const data = new Uint8Array([1, 2, 3]);

test("ZIP supports folders, mixed selection, and ignores unrelated files", async () => {
  const archive = await zip([["rides/ride.FIT", data], ["readme.txt", data]]);
  const result = await expandFitInputs([archive, new File([data], "other.fit")]);
  assert.deepEqual(result.files.map(file => file.name), ["rides/ride.FIT", "other.fit"]);
  assert.deepEqual(new Uint8Array(await result.files[0].arrayBuffer()), data);
  assert.equal(result.ignored, 1);
});
test("rejects corrupt ZIPs, nested archives, encrypted entries and unsafe paths", async () => {
  await assert.rejects(expandFitInputs([new File([data], "bad.zip")]));
  for (const name of ["../ride.fit", "C:/ride.fit", "nested.zip"]) {
    await assert.rejects(expandFitInputs([await zip([[name, data]])]));
  }
  await assert.rejects(expandFitInputs([await zip([["ride.fit", data]], { password: "secret" })]), /Password-protected/);
});
test("rejects empty archives and limits counts, input and cumulative output", async () => {
  await assert.rejects(expandFitInputs([await zip([["readme.txt", data]])]), /no supported FIT/);
  const archive = await zip([["ride.fit", data]]);
  await assert.rejects(expandFitInputs([archive], Array.from({ length: 200 }, (_, i) => ({ name: `${i}.fit`, size: 1 }))), /200 FIT/);
  await assert.rejects(expandFitInputs([archive], [{ name: "old.fit", size: MAX_BATCH_BYTES }]), /500 MB/);
  await assert.rejects(expandFitInputs([new File([new Uint8Array(MAX_ZIP_BYTES + 1)], "big.zip")]), /100 MB/);
  await assert.rejects(expandFitInputs([await zip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`${i}.txt`, data]))]), /1,000/);
});
test("rejects oversized expanded FIT and checksum corruption", async () => {
  await assert.rejects(expandFitInputs([await zip([["big.fit", new Uint8Array(MAX_FIT_BYTES + 1)]])]), /20 MB/);
  const stored = new Uint8Array(await (await zip([["ride.fit", data]], { level: 0 })).arrayBuffer());
  const header = new DataView(stored.buffer);
  stored[30 + header.getUint16(26, true) + header.getUint16(28, true)] ^= 0xff;
  await assert.rejects(expandFitInputs([new File([stored], "corrupt.zip")]), /signature|CRC|checksum/i);
});
