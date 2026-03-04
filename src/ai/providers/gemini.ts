import { makeGeneratedAsset } from "../image-utils";
import type { GenerateRequest, ProviderAdapter } from "../types";

export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function b64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  let detail = "";
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    detail = json.error?.message ? `: ${json.error.message}` : "";
  } catch {
    // Ignore parsing failure.
  }
  throw new Error(`Gemini request failed (${response.status})${detail}`);
}

function buildPromptText(req: GenerateRequest): string {
  if (!req.negativePrompt) {
    return req.prompt;
  }
  return `${req.prompt}\n\nAvoid: ${req.negativePrompt}`;
}

export function createGeminiAdapter(getConfig: () => GeminiConfig): ProviderAdapter {
  return {
    async generate(req: GenerateRequest, signal?: AbortSignal) {
      const config = getConfig();
      if (!config.apiKey.trim()) {
        throw new Error("Missing Gemini API key");
      }

      const baseUrl = normalizeBaseUrl(config.baseUrl || "https://generativelanguage.googleapis.com");
      const model = req.model;
      const apiUrl = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

      const parts: GeminiPart[] = [
        {
          text: buildPromptText(req),
        },
      ];

      if (req.mode === "image_to_image") {
        if (!req.imageSource) {
          throw new Error("Image source is required for image-to-image mode");
        }
        const data = await req.imageSource.blob.arrayBuffer();
        const bytes = new Uint8Array(data);
        let binary = "";
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        parts.push({
          inlineData: {
            mimeType: req.imageSource.mimeType || "image/png",
            data: btoa(binary),
          },
        });
      }

      const response = await fetch(apiUrl, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            candidateCount: Math.max(1, req.outputCount),
          },
        }),
      });

      await ensureOk(response);

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
      };

      const blobs: Blob[] = [];
      for (const candidate of payload.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            blobs.push(b64ToBlob(part.inlineData.data, part.inlineData.mimeType || "image/png"));
          }
        }
      }

      if (blobs.length === 0) {
        throw new Error("Gemini returned no images");
      }

      const assets = [];
      for (const blob of blobs) {
        // eslint-disable-next-line no-await-in-loop
        assets.push(await makeGeneratedAsset(blob));
      }
      return assets;
    },
  };
}
