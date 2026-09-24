/** 1000 one-hour rides use about 300 MB of browser memory (PERF=1 pnpm test:browser export-perf). */
export const MAX_FIT_FILES = 1000;
export const MAX_FIT_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 1024 * 1024 * 1024;
export const MAX_ZIP_BYTES = 250 * 1024 * 1024;
/** ZIPs may hold non-FIT entries too, so allow more entries than files. */
export const MAX_ZIP_ENTRIES = 5000;

/** Human-readable limits for UI and error messages, e.g. "1 GB" or "250 MB". */
export const formatBytes = (bytes: number) => bytes >= 1024 ** 3 ? `${bytes / 1024 ** 3} GB` : `${bytes / 1024 ** 2} MB`;

export function isFitFile(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".fit");
}

export function validateFitFile(file: Pick<File, "name" | "size">): string | null {
  if (!isFitFile(file)) return "Please choose a .fit file.";
  if (file.size === 0) return "This file is empty. Choose a FIT file recorded by your device.";
  if (file.size > MAX_FIT_BYTES) return `This file is too large. Choose a FIT file under ${formatBytes(MAX_FIT_BYTES)}.`;
  return null;
}

export function validateFitBatch(files: Pick<File, "name" | "size">[]): string | null {
  if (files.length === 0 || files.length > MAX_FIT_FILES) return `Please select between 1 and ${MAX_FIT_FILES} FIT files.`;
  for (const file of files) {
    const error = validateFitFile(file);
    if (error) return file.name + ": " + error;
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) return `The batch is too large. Maximum total size is ${formatBytes(MAX_BATCH_BYTES)}.`;
  return null;
}
