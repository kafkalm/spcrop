import { describe, expect, it } from "vitest";

import {
  GEMINI_MODEL_PRESET_BY_ID,
  isImageSourceKind,
  resolveGeminiModelPreset,
} from "../ai/ui-options";

describe("ai ui options", () => {
  it("accepts uploaded_file as a valid image source kind", () => {
    expect(isImageSourceKind("uploaded_file")).toBe(true);
    expect(isImageSourceKind("crop")).toBe(true);
    expect(isImageSourceKind("unknown")).toBe(false);
  });

  it("includes NanoBanana Pro and NanoBanana 2 presets", () => {
    expect(GEMINI_MODEL_PRESET_BY_ID.nanobanana_pro.model).toBe("nanobanana-pro");
    expect(GEMINI_MODEL_PRESET_BY_ID.nanobanana_2.model).toBe("nanobanana-2");
  });

  it("maps configured model to known preset id", () => {
    expect(resolveGeminiModelPreset("nanobanana-pro")).toBe("nanobanana_pro");
    expect(resolveGeminiModelPreset("nanobanana-2")).toBe("nanobanana_2");
    expect(resolveGeminiModelPreset("custom-model-x")).toBe("custom");
  });
});
