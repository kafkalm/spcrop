import { describe, expect, it } from "vitest";

import {
  collectImageUrlsFromChatResponse,
  normalizeOpenRouterBaseUrl,
} from "../providers/openrouter";

describe("normalizeOpenRouterBaseUrl", () => {
  it("uses canonical base with /api/v1", () => {
    expect(normalizeOpenRouterBaseUrl("https://openrouter.ai")).toBe("https://openrouter.ai/api/v1");
  });

  it("keeps explicit /api/v1 unchanged", () => {
    expect(normalizeOpenRouterBaseUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
  });
});

describe("collectImageUrlsFromChatResponse", () => {
  it("extracts URLs from message.images in both camelCase and snake_case forms", () => {
    const urls = collectImageUrlsFromChatResponse({
      choices: [
        {
          message: {
            images: [
              { imageUrl: { url: "https://example.com/a.png" } },
              { image_url: { url: "https://example.com/b.png" } },
            ],
          },
        },
      ],
    });

    expect(urls).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
  });

  it("extracts URLs from image parts in message.content", () => {
    const urls = collectImageUrlsFromChatResponse({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "ok" },
              { type: "image_url", imageUrl: { url: "https://example.com/c.png" } },
              { type: "image_url", image_url: { url: "https://example.com/d.png" } },
              { type: "input_image", imageUrl: "https://example.com/e.png" },
              { type: "output_image", url: "https://example.com/f.png" },
            ],
          },
        },
      ],
    });

    expect(urls).toEqual([
      "https://example.com/c.png",
      "https://example.com/d.png",
      "https://example.com/e.png",
      "https://example.com/f.png",
    ]);
  });

  it("extracts URLs from image generation tool-call style payloads", () => {
    const urls = collectImageUrlsFromChatResponse({
      choices: [
        {
          message: {
            toolCalls: [
              { type: "image_generation_call", result: "https://example.com/g.png" },
              { type: "function_call", result: "ignore me" },
            ],
            tool_calls: [
              { type: "image_generation_call", result: "https://example.com/h.png" },
            ],
          },
        },
      ],
    });

    expect(urls).toEqual([
      "https://example.com/g.png",
      "https://example.com/h.png",
    ]);
  });
});
