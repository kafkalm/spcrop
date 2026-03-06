import { OpenRouter } from "@openrouter/sdk";

import { dataUrlToBlob, makeGeneratedAsset } from "../image-utils";
import type { GenerateRequest, ProviderAdapter } from "../types";

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
}

type UnknownRecord = Record<string, unknown>;

type OpenRouterUserContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } }
>;

export function normalizeOpenRouterBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || "https://openrouter.ai/api/v1").trim();
  const noTrailingSlash = trimmed.replace(/\/+$/, "");
  if (!noTrailingSlash) {
    return "https://openrouter.ai/api/v1";
  }
  if (/\/api\/v1$/i.test(noTrailingSlash) || /\/v1$/i.test(noTrailingSlash)) {
    return noTrailingSlash;
  }
  if (/\/api$/i.test(noTrailingSlash)) {
    return `${noTrailingSlash}/v1`;
  }
  return `${noTrailingSlash}/api/v1`;
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

  const nestedCamel = readUrlFromUnknown(value.imageUrl);
  if (nestedCamel) {
    return nestedCamel;
  }
  return readUrlFromUnknown(value.image_url);
}

function collectUrlsFromMessageContent(content: unknown, out: Set<string>): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    const partType = toNonEmptyString(part.type);
    if (partType && !partType.includes("image")) {
      continue;
    }
    const url =
      readUrlFromUnknown(part.imageUrl)
      ?? readUrlFromUnknown(part.image_url)
      ?? readUrlFromUnknown(part.url)
      ?? readUrlFromUnknown(part.result);
    if (url) {
      out.add(url);
    }
  }
}

function collectUrlsFromMessageImages(images: unknown, out: Set<string>): void {
  if (!Array.isArray(images)) {
    return;
  }
  for (const image of images) {
    const url = readUrlFromUnknown(image);
    if (url) {
      out.add(url);
    }
  }
}

function collectUrlsFromToolCalls(toolCalls: unknown, out: Set<string>): void {
  if (!Array.isArray(toolCalls)) {
    return;
  }
  for (const call of toolCalls) {
    if (!isRecord(call) || toNonEmptyString(call.type) !== "image_generation_call") {
      continue;
    }
    const url =
      readUrlFromUnknown(call.result)
      ?? readUrlFromUnknown(call.imageUrl)
      ?? readUrlFromUnknown(call.image_url)
      ?? readUrlFromUnknown(call.url);
    if (url) {
      out.add(url);
    }
  }
}

function collectUrlsFromResponsesOutput(output: unknown, out: Set<string>): void {
  if (!Array.isArray(output)) {
    return;
  }
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    const itemType = toNonEmptyString(item.type);
    if (itemType === "image_generation_call") {
      const url = readUrlFromUnknown(item.result) ?? readUrlFromUnknown(item.imageUrl);
      if (url) {
        out.add(url);
      }
      continue;
    }
    if (itemType === "message") {
      collectUrlsFromMessageContent(item.content, out);
    }
  }
}

export function collectImageUrlsFromChatResponse(response: unknown): string[] {
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
    collectUrlsFromMessageImages(message.images, imageUrls);
    collectUrlsFromMessageContent(message.content, imageUrls);
    collectUrlsFromToolCalls(message.toolCalls, imageUrls);
    collectUrlsFromToolCalls(message.tool_calls, imageUrls);
  }

  collectUrlsFromResponsesOutput(response.output, imageUrls);
  return Array.from(imageUrls);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Failed to read image source"));
    };
    reader.onerror = () => reject(new Error("Failed to read image source"));
    reader.readAsDataURL(blob);
  });
}

async function imageUrlToBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    return dataUrlToBlob(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenRouter image URL download failed (${response.status})`);
  }
  return await response.blob();
}

function toOpenRouterError(error: unknown): Error {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = String((error as { statusCode?: unknown }).statusCode ?? "unknown");
    const message = String((error as { message?: unknown }).message ?? "request failed");
    return new Error(`OpenRouter request failed (${statusCode}): ${message}`);
  }
  if (error instanceof Error) {
    return new Error(`OpenRouter request failed: ${error.message}`);
  }
  return new Error("OpenRouter request failed");
}

export function createOpenRouterAdapter(getConfig: () => OpenRouterConfig): ProviderAdapter {
  return {
    async generate(req: GenerateRequest, signal?: AbortSignal) {
      const config = getConfig();
      const apiKey = config.apiKey.trim();
      if (!apiKey) {
        throw new Error("Missing OpenRouter API key");
      }

      const client = new OpenRouter({
        apiKey,
        serverURL: normalizeOpenRouterBaseUrl(config.baseUrl),
      });

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
          const content: OpenRouterUserContent = sourceImageDataUrl
            ? [
              { type: "text", text: prompt },
              { type: "image_url", imageUrl: { url: sourceImageDataUrl } },
            ]
            : prompt;

          // eslint-disable-next-line no-await-in-loop
          const response = await client.chat.send({
            chatGenerationParams: {
              model: req.model,
              stream: false,
              modalities: ["image"],
              messages: [
                {
                  role: "user",
                  content,
                },
              ],
            },
          }, {
            signal,
          });

          const imageUrls = collectImageUrlsFromChatResponse(response);

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
        throw toOpenRouterError(error);
      }

      if (blobs.length === 0) {
        throw new Error("OpenRouter returned no images");
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
