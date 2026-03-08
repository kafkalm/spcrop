import { describe, expect, it } from "vitest";

import {
  collectImageUrlsFromPoeResponse,
  createPoeRequestHeaders,
  normalizePoeBaseUrl,
} from "../providers/poe";

describe("normalizePoeBaseUrl", () => {
  it("uses canonical /v1 path", () => {
    expect(normalizePoeBaseUrl("https://api.poe.com")).toBe("https://api.poe.com/v1");
  });

  it("keeps explicit /v1 unchanged", () => {
    expect(normalizePoeBaseUrl("https://api.poe.com/v1")).toBe("https://api.poe.com/v1");
  });
});

describe("collectImageUrlsFromPoeResponse", () => {
  it("extracts image URLs from content parts", () => {
    const urls = collectImageUrlsFromPoeResponse({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "ok" },
              { type: "image_url", image_url: { url: "https://example.com/a.png" } },
              { type: "output_image", url: "https://example.com/b.png" },
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
});

describe("createPoeRequestHeaders", () => {
  it("only includes authorization and content-type for CORS-safe browser calls", () => {
    const headers = createPoeRequestHeaders("test_key");

    expect(headers).toEqual({
      Authorization: "Bearer test_key",
      "Content-Type": "application/json",
    });
    expect(Object.keys(headers).some((key) => key.toLowerCase().startsWith("x-stainless"))).toBe(false);
  });
});
