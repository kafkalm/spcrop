import { describe, expect, it } from "vitest";

import { normalizeOpenAIBaseUrl } from "../providers/openai";

describe("normalizeOpenAIBaseUrl", () => {
  it("keeps canonical base URL unchanged", () => {
    expect(normalizeOpenAIBaseUrl("https://api.openai.com")).toBe("https://api.openai.com");
  });

  it("removes trailing slash", () => {
    expect(normalizeOpenAIBaseUrl("https://api.openai.com/")).toBe("https://api.openai.com");
  });

  it("normalizes base URL that already includes /v1", () => {
    expect(normalizeOpenAIBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com");
    expect(normalizeOpenAIBaseUrl("https://api.openai.com/v1/")).toBe("https://api.openai.com");
  });
});
