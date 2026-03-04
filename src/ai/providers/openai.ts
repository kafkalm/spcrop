import { makeGeneratedAsset } from "../image-utils";
import type { GenerateRequest, ProviderAdapter } from "../types";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
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
  throw new Error(`OpenAI request failed (${response.status})${detail}`);
}

function b64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function responseDataToAssets(data: Array<{ b64_json?: string; url?: string }>): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const item of data) {
    if (item.b64_json) {
      blobs.push(b64ToBlob(item.b64_json, "image/png"));
      continue;
    }
    if (item.url) {
      const fetched = await fetch(item.url);
      if (!fetched.ok) {
        throw new Error("OpenAI image URL download failed");
      }
      blobs.push(await fetched.blob());
    }
  }
  return blobs;
}

export function createOpenAIAdapter(getConfig: () => OpenAIConfig): ProviderAdapter {
  return {
    async generate(req: GenerateRequest, signal?: AbortSignal) {
      const config = getConfig();
      if (!config.apiKey.trim()) {
        throw new Error("Missing OpenAI API key");
      }

      const headers = {
        Authorization: `Bearer ${config.apiKey}`,
      };

      const baseUrl = normalizeBaseUrl(config.baseUrl || "https://api.openai.com");

      if (req.mode === "text_to_image") {
        const response = await fetch(`${baseUrl}/v1/images/generations`, {
          method: "POST",
          signal,
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: req.model,
            prompt: req.negativePrompt
              ? `${req.prompt}\n\nNegative prompt: ${req.negativePrompt}`
              : req.prompt,
            n: Math.max(1, req.outputCount),
            response_format: "b64_json",
          }),
        });

        await ensureOk(response);
        const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
        const blobs = await responseDataToAssets(payload.data ?? []);
        if (blobs.length === 0) {
          throw new Error("OpenAI returned no images");
        }
        const assets = [];
        for (const blob of blobs) {
          // eslint-disable-next-line no-await-in-loop
          assets.push(await makeGeneratedAsset(blob));
        }
        return assets;
      }

      if (!req.imageSource) {
        throw new Error("Image source is required for image-to-image mode");
      }

      const formData = new FormData();
      formData.append("model", req.model);
      formData.append(
        "prompt",
        req.negativePrompt ? `${req.prompt}\n\nNegative prompt: ${req.negativePrompt}` : req.prompt,
      );
      formData.append("n", String(Math.max(1, req.outputCount)));
      formData.append("response_format", "b64_json");
      formData.append("image", req.imageSource.blob, req.imageSource.name || "source.png");

      const response = await fetch(`${baseUrl}/v1/images/edits`, {
        method: "POST",
        signal,
        headers,
        body: formData,
      });

      await ensureOk(response);
      const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      const blobs = await responseDataToAssets(payload.data ?? []);
      if (blobs.length === 0) {
        throw new Error("OpenAI returned no images");
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
