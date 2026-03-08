import { describe, expect, it } from "vitest";

import { resolveFallbackProvider } from "../request-config";

describe("resolveFallbackProvider", () => {
  it("does not auto-fallback when fallback provider is not explicitly selected", () => {
    const fallback = resolveFallbackProvider({
      primaryProvider: "openai",
      enableFallback: true,
      fallbackProvider: "",
    });

    expect(fallback).toBeUndefined();
  });

  it("returns explicit fallback provider when selected and different from primary", () => {
    const fallback = resolveFallbackProvider({
      primaryProvider: "openai",
      enableFallback: true,
      fallbackProvider: "gemini",
    });

    expect(fallback).toBe("gemini");
  });

  it("supports openrouter as explicit fallback provider", () => {
    const fallback = resolveFallbackProvider({
      primaryProvider: "gemini",
      enableFallback: true,
      fallbackProvider: "openrouter",
    });

    expect(fallback).toBe("openrouter");
  });

  it("supports poe as explicit fallback provider", () => {
    const fallback = resolveFallbackProvider({
      primaryProvider: "gemini",
      enableFallback: true,
      fallbackProvider: "poe",
    });

    expect(fallback).toBe("poe");
  });

  it("returns undefined when fallback is disabled", () => {
    const fallback = resolveFallbackProvider({
      primaryProvider: "openai",
      enableFallback: false,
      fallbackProvider: "gemini",
    });

    expect(fallback).toBeUndefined();
  });
});
