import { dataUrlToBlob, makeGeneratedAsset } from "../image-utils";
import type { GenerateRequest, ProviderAdapter } from "../types";

export interface PoeConfig {
  apiKey: string;
  baseUrl: string;
}

type UnknownRecord = Record<string, unknown>;

type PoeUserContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

export function normalizePoeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || "https://api.poe.com").trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  if (!noTrailingSlash) {
    return "https://api.poe.com/v1";
  }
  if (/\/v1$/i.test(noTrailingSlash)) {
    return noTrailingSlash;
  }
  return `${noTrailingSlash}/v1`;
}

export function createPoeRequestHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function buildPromptText(req: GenerateRequest): string {
  if (!req.negativePrompt) {
    return req.prompt;
  }
  return `${req.prompt}\n\nNegative prompt: ${req.negativePrompt}`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readUrlFromUnknown(value: unknown): string | undefined {
  const direct = toNonEmptyString(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const url = toNonEmptyString(value.url);
  if (url) {
    return url;
  }

  const nestedSnake = readUrlFromUnknown(value.image_url);
  if (nestedSnake) {
    return nestedSnake;
  }
  return readUrlFromUnknown(value.imageUrl);
}

export function collectImageUrlsFromPoeResponse(response: unknown): string[] {
  if (!isRecord(response)) {
    return [];
  }

  const imageUrls = new Set<string>();
  const choices = Array.isArray(response.choices) ? response.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      continue;
    }

    const message = choice.message;
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!isRecord(part)) {
          continue;
        }
        const partType = toNonEmptyString(part.type);
        if (partType && !partType.includes("image")) {
          continue;
        }
        const url =
          readUrlFromUnknown(part.image_url)
          ?? readUrlFromUnknown(part.imageUrl)
          ?? readUrlFromUnknown(part.url)
          ?? readUrlFromUnknown(part.result);
        if (url) {
          imageUrls.add(url);
        }
      }
    }

    if (Array.isArray(message.images)) {
      for (const image of message.images) {
        const url = readUrlFromUnknown(image);
        if (url) {
          imageUrls.add(url);
        }
      }
    }
  }

  return Array.from(imageUrls);
}

async function imageUrlToBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    return dataUrlToBlob(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`POE image URL download failed (${response.status})`);
  }
  return await response.blob();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Failed to read image source"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image source"));
    reader.readAsDataURL(blob);
  });
}

function extractPoeErrorMessage(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }
  if (isRecord(body.error)) {
    const nested = toNonEmptyString(body.error.message);
    if (nested) {
      return nested;
    }
  }
  return toNonEmptyString(body.message);
}

async function callPoeChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  content: PoeUserContent,
  signal?: AbortSignal,
): Promise<unknown> {
  const endpoint = `${normalizePoeBaseUrl(baseUrl)}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: createPoeRequestHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      stream: false,
    }),
    signal,
  });

  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    const message = extractPoeErrorMessage(parsed) ?? `HTTP ${response.status}`;
    throw new Error(`POE request failed (${response.status}): ${message}`);
  }
  return parsed;
}

function toPoeError(error: unknown): Error {
  if (error instanceof Error) {
    return new Error(`POE request failed: ${error.message}`);
  }
  return new Error("POE request failed");
}

export function createPoeAdapter(getConfig: () => PoeConfig): ProviderAdapter {
  return {
    async generate(req: GenerateRequest, signal?: AbortSignal) {
      const config = getConfig();
      const apiKey = config.apiKey.trim();
      if (!apiKey) {
        throw new Error("Missing POE API key");
      }

      const prompt = buildPromptText(req);
      const runs = Math.max(1, req.outputCount);
      const blobs: Blob[] = [];

      try {
        let sourceImageDataUrl: string | undefined;
        if (req.mode === "image_to_image") {
          if (!req.imageSource) {
            throw new Error("Image source is required for image-to-image mode");
          }
          sourceImageDataUrl = await blobToDataUrl(req.imageSource.blob);
        }

        for (let i = 0; i < runs; i++) {
          const content: PoeUserContent = sourceImageDataUrl
            ? [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: sourceImageDataUrl } },
            ]
            : prompt;

          // eslint-disable-next-line no-await-in-loop
          const response = await callPoeChatCompletions(
            config.baseUrl || "https://api.poe.com",
            apiKey,
            req.model,
            content,
            signal,
          );

          const imageUrls = collectImageUrlsFromPoeResponse(response);
          for (const url of imageUrls) {
            // eslint-disable-next-line no-await-in-loop
            const blob = await imageUrlToBlob(url);
            blobs.push(blob);
            if (blobs.length >= runs) {
              break;
            }
          }
          if (blobs.length >= runs) {
            break;
          }
        }
      } catch (error) {
        throw toPoeError(error);
      }

      if (blobs.length === 0) {
        throw new Error("POE returned no images");
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
