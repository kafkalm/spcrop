import { describe, expect, it } from "vitest";

import type { GenerateRequest, GeneratedAsset, ProviderAdapter, ProviderId } from "../types";
import { runWithFallback } from "../provider-router";

function makeRequest(provider: ProviderId): GenerateRequest {
  return {
    provider,
    mode: "text_to_image",
    prompt: "pixel fox",
    model: "model-a",
    outputCount: 1,
    fallbackProvider: provider === "openai" ? "gemini" : "openai",
  };
}

function makeAsset(name: string): GeneratedAsset {
  return {
    mimeType: "image/png",
    blob: new Blob([name], { type: "image/png" }),
    thumbDataUrl: `data:image/png;base64,${btoa(name)}`,
    width: 64,
    height: 64,
  };
}

describe("runWithFallback", () => {
  it("returns primary provider result when primary succeeds", async () => {
    const calls: ProviderId[] = [];
    const openai: ProviderAdapter = {
      generate: async () => {
        calls.push("openai");
        return [makeAsset("openai")];
      },
    };
    const gemini: ProviderAdapter = {
      generate: async () => {
        calls.push("gemini");
        return [makeAsset("gemini")];
      },
    };

    const result = await runWithFallback(makeRequest("openai"), { openai, gemini });

    expect(result.providerUsed).toBe("openai");
    expect(result.fallbackFrom).toBeNull();
    expect(result.assets).toHaveLength(1);
    expect(calls).toEqual(["openai"]);
  });

  it("falls back when primary fails and fallback is configured", async () => {
    const calls: ProviderId[] = [];
    const openai: ProviderAdapter = {
      generate: async () => {
        calls.push("openai");
        throw new Error("boom");
      },
    };
    const gemini: ProviderAdapter = {
      generate: async () => {
        calls.push("gemini");
        return [makeAsset("gemini")];
      },
    };

    const result = await runWithFallback(makeRequest("openai"), { openai, gemini });

    expect(result.providerUsed).toBe("gemini");
    expect(result.fallbackFrom).toBe("openai");
    expect(calls).toEqual(["openai", "gemini"]);
  });

  it("throws primary error when fallback is disabled", async () => {
    const openai: ProviderAdapter = {
      generate: async () => {
        throw new Error("primary failed");
      },
    };
    const gemini: ProviderAdapter = {
      generate: async () => [makeAsset("gemini")],
    };

    await expect(
      runWithFallback(
        {
          ...makeRequest("openai"),
          fallbackProvider: undefined,
        },
        { openai, gemini },
      ),
    ).rejects.toThrow("primary failed");
  });
});
