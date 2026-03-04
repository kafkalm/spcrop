import type { ImageInput, ImageSourceKind } from "./types";

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert canvas to blob"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

export async function imageBitmapToPngBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context is unavailable");
  }
  ctx.drawImage(bitmap, 0, 0);
  return canvasToPngBlob(canvas);
}

export function buildImageInput(kind: ImageSourceKind, blob: Blob, name?: string): ImageInput {
  return {
    kind,
    blob,
    mimeType: blob.type || "image/png",
    name,
  };
}
