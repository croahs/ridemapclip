import { BlobReader, ZipReader, configure } from "@zip.js/zip.js";
import { MAX_BATCH_BYTES, MAX_FIT_BYTES, MAX_FIT_FILES, validateFitBatch, validateFitFile } from "./limits";

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 1000;
configure({ useWebWorkers: false, chunkSize: 64 * 1024 });

/** Runs in a disposable worker. Archives never touch the filesystem or server. */
export async function expandFitInputs(incoming: File[], existing: Pick<File, "name" | "size">[] = []) {
  if (!incoming.length || incoming.length > MAX_FIT_FILES) throw new Error("Choose between 1 and 200 FIT or ZIP files.");
  if (incoming.reduce((n, file) => n + file.size, 0) > MAX_BATCH_BYTES) throw new Error("Selected input exceeds 500 MB.");
  for (const file of incoming) {
    if (/\.zip$/i.test(file.name)) {
      if (!file.size || file.size > MAX_ZIP_BYTES) throw new Error("Each ZIP must be non-empty and no larger than 100 MB.");
    } else {
      const error = validateFitFile(file);
      if (error) throw new Error(`${file.name}: ${error}`);
    }
  }
  const files: File[] = [];
  let total = existing.reduce((n, file) => n + file.size, 0);
  let entries = 0;
  let ignored = 0;
  const reserveFile = () => {
    if (existing.length + files.length >= MAX_FIT_FILES) throw new Error("A selection can contain at most 200 FIT files after extraction.");
  };
  const account = (bytes: number) => {
    total += bytes;
    if (total > MAX_BATCH_BYTES) throw new Error("Extracted FIT files exceed the 500 MB total limit.");
  };
  for (const input of incoming) {
    if (!/\.zip$/i.test(input.name)) {
      reserveFile(); account(input.size); files.push(input); continue;
    }
    const reader = new ZipReader(new BlobReader(input), {
      useWebWorkers: false, strictness: "strict", filenameValidation: "strict", checkSignature: true,
    });
    let fits = 0;
    try {
      for await (const entry of reader.getEntriesGenerator()) {
        if (++entries > MAX_ZIP_ENTRIES) throw new Error("ZIP selection contains more than 1,000 archive entries.");
        // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
        if (entry.filename.length > 512 || /[\x00-\x1f\x7f]/.test(entry.filename)) throw new Error("ZIP contains an unsafe filename.");
        if (entry.encrypted) throw new Error("Password-protected ZIP files are not supported.");
        if (entry.symlink) throw new Error("ZIP symbolic links are not supported.");
        if (entry.directory) continue;
        if (/\.(zip|7z|rar|tar|gz|bz2|xz)$/i.test(entry.filename)) throw new Error("Nested archives are not supported. Choose a ZIP containing FIT files directly.");
        if (!/\.fit$/i.test(entry.filename) || entry.filename.startsWith("__MACOSX/") || entry.filename.split("/").pop()!.startsWith("._")) { ignored++; continue; }
        reserveFile();
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize <= 0 || entry.uncompressedSize > MAX_FIT_BYTES) throw new Error("Each extracted FIT must be non-empty and no larger than 20 MB.");
        if (total + entry.uncompressedSize > MAX_BATCH_BYTES) throw new Error("Extracted FIT files exceed the 500 MB total limit.");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        await entry.getData(new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.byteLength;
            if (size > MAX_FIT_BYTES) throw new Error("An extracted FIT exceeds the 20 MB limit.");
            account(chunk.byteLength);
            chunks.push(new Uint8Array(chunk));
          },
        }), { checkSignature: true, useWebWorkers: false });
        if (size !== entry.uncompressedSize) throw new Error("ZIP entry size does not match its contents.");
        // Keep relative folders for display/identity only; never use a ZIP name as a disk path.
        files.push(new File(chunks, entry.filename, { lastModified: entry.lastModDate?.getTime() ?? 0 }));
        fits++;
      }
      if (!fits) throw new Error("ZIP contains no supported FIT files.");
    } catch (error) {
      throw new Error(`${input.name}: ${error instanceof Error ? error.message : "Invalid ZIP archive."}`, { cause: error });
    } finally {
      await reader.close();
    }
  }
  const validation = validateFitBatch([...existing, ...files]);
  if (validation) throw new Error(validation);
  return { files, ignored };
}
