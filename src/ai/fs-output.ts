import type { ProviderId } from "./types";

export interface OutputFilenameInput {
  provider: ProviderId;
  taskId: string;
  index: number;
  date?: Date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function formatOutputFilename(input: OutputFilenameInput): string {
  const d = input.date ?? new Date();
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());

  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${input.provider}-${sanitizeSegment(input.taskId)}-${pad(input.index)}.png`;
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function selectOutputDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsDirectoryPicker()) {
    throw new Error("Directory picker is not supported in this browser");
  }
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  const queried = await handle.queryPermission(opts);
  if (queried === "granted") {
    return true;
  }
  const requested = await handle.requestPermission(opts);
  return requested === "granted";
}

export async function queryDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  const queried = await handle.queryPermission(opts);
  return queried === "granted";
}

export async function writeBlobToDirectory(
  handle: FileSystemDirectoryHandle,
  blob: Blob,
  filename: string,
): Promise<void> {
  const hasPermission = await ensureDirectoryPermission(handle);
  if (!hasPermission) {
    throw new Error("No permission to write to selected directory");
  }
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function downloadBlobFallback(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
