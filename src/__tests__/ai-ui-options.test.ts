import { describe, expect, it } from "vitest";

import {
  GEMINI_MODEL_PRESET_BY_ID,
  isImageSourceKind,
  normalizeGeminiModelId,
  resolveGeminiModelPreset,
} from "../ai/ui-options";

describe("ai ui options", () => {
  it("accepts uploaded_file as a valid image source kind", () => {
    expect(isImageSourceKind("uploaded_file")).toBe(true);
    expect(isImageSourceKind("crop")).toBe(true);
    expect(isImageSourceKind("unknown")).toBe(false);
  });

  it("includes NanoBanana Pro and NanoBanana 2 presets", () => {
    expect(GEMINI_MODEL_PRESET_BY_ID.nanobanana.model).toBe("gemini-2.5-flash-image");
    expect(GEMINI_MODEL_PRESET_BY_ID.nanobanana_pro.model).toBe("gemini-3.0-image-preview");
    expect(GEMINI_MODEL_PRESET_BY_ID.nanobanana_2.model).toBe("gemini-3.1-flash-image-preview");
  });

  it("maps configured model to known preset id", () => {
    expect(resolveGeminiModelPreset("gemini-3.0-image-preview")).toBe("nanobanana_pro");
    expect(resolveGeminiModelPreset("gemini-3.1-flash-image-preview")).toBe("nanobanana_2");
    expect(resolveGeminiModelPreset("custom-model-x")).toBe("custom");
  });

  it("normalizes legacy nanobanana model id", () => {
    expect(normalizeGeminiModelId("gemini-2.5-flash-image-preview")).toBe("gemini-2.5-flash-image");
    expect(normalizeGeminiModelId("nanobanana-pro")).toBe("gemini-3.0-image-preview");
    expect(normalizeGeminiModelId("nanobanana-2")).toBe("gemini-3.1-flash-image-preview");
    expect(normalizeGeminiModelId("gemini-3.0-image-preview")).toBe("gemini-3.0-image-preview");
  });
});
