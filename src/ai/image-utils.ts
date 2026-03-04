import type { GeneratedAsset } from "./types";

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read blob as data URL"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read blob"));
    };
    reader.readAsDataURL(blob);
  });
}

export async function makeGeneratedAsset(blob: Blob): Promise<GeneratedAsset> {
  const thumbDataUrl = await blobToDataUrl(blob);
  let width: number | undefined;
  let height: number | undefined;
  try {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // Ignore decode failures for width/height probing.
  }

  return {
    mimeType: blob.type || "image/png",
    blob,
    width,
    height,
    thumbDataUrl,
  };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  if (!header || !payload) {
    throw new Error("Invalid data URL");
  }
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
