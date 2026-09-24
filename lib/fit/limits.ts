export const MAX_FIT_FILES = 200;
export const MAX_FIT_BYTES = 20 * 1024 * 1024;

export function isFitFile(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".fit");
}

export function validateFitFile(file: Pick<File, "name" | "size">): string | null {
  if (!isFitFile(file)) return "Please choose a .fit file.";
  if (file.size === 0) return "This file is empty. Choose a FIT file recorded by your device.";
  if (file.size > MAX_FIT_BYTES) return "This file is too large. Choose a FIT file under 20 MB.";
  return null;
}

export const MAX_BATCH_BYTES = 500 * 1024 * 1024;
export function validateFitBatch(files: Pick<File, "name" | "size">[]): string | null {
  if (files.length === 0 || files.length > MAX_FIT_FILES) return "Please select between 1 and 200 FIT files.";
  for (const file of files) {
    const error = validateFitFile(file);
    if (error) return file.name + ": " + error;
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES) return "The batch is too large. Maximum total size is 500 MB.";
  return null;
}
