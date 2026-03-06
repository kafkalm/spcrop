import type { ImageSourceKind } from "./types";

export type GeminiModelPresetId = "nanobanana" | "nanobanana_pro" | "nanobanana_2" | "custom";

export interface GeminiModelPreset {
  id: Exclude<GeminiModelPresetId, "custom">;
  label: string;
  model: string;
}

export const GEMINI_MODEL_PRESETS: GeminiModelPreset[] = [
  {
    id: "nanobanana",
    label: "NanoBanana",
    model: "gemini-2.5-flash-image-preview",
  },
  {
    id: "nanobanana_pro",
    label: "NanoBanana Pro",
    model: "nanobanana-pro",
  },
  {
    id: "nanobanana_2",
    label: "NanoBanana 2",
    model: "nanobanana-2",
  },
];

export const GEMINI_MODEL_PRESET_BY_ID: Record<Exclude<GeminiModelPresetId, "custom">, GeminiModelPreset> = {
  nanobanana: GEMINI_MODEL_PRESETS[0],
  nanobanana_pro: GEMINI_MODEL_PRESETS[1],
  nanobanana_2: GEMINI_MODEL_PRESETS[2],
};

export function isImageSourceKind(value: string): value is ImageSourceKind {
  return value === "crop" || value === "active_layer" || value === "gallery_item" || value === "uploaded_file";
}

export function resolveGeminiModelPreset(model: string): GeminiModelPresetId {
  const normalized = model.trim();
  for (const preset of GEMINI_MODEL_PRESETS) {
    if (preset.model === normalized) {
      return preset.id;
    }
  }
  return "custom";
}
