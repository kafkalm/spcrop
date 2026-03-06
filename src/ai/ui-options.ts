import type { ImageSourceKind, ProviderId } from "./types";

export type GeminiModelPresetId = "nanobanana" | "nanobanana_pro" | "nanobanana_2" | "custom";

export interface GeminiModelPreset {
  id: Exclude<GeminiModelPresetId, "custom">;
  label: string;
  model: string;
}

export interface ProviderModelPreset {
  id: string;
  label: string;
  model: string;
}

export const GEMINI_MODEL_PRESETS: GeminiModelPreset[] = [
  {
    id: "nanobanana",
    label: "NanoBanana",
    model: "gemini-2.5-flash-image",
  },
  {
    id: "nanobanana_pro",
    label: "NanoBanana Pro",
    model: "gemini-3.0-image-preview",
  },
  {
    id: "nanobanana_2",
    label: "NanoBanana 2",
    model: "gemini-3.1-flash-image-preview",
  },
];

export const GEMINI_MODEL_PRESET_BY_ID: Record<Exclude<GeminiModelPresetId, "custom">, GeminiModelPreset> = {
  nanobanana: GEMINI_MODEL_PRESETS[0],
  nanobanana_pro: GEMINI_MODEL_PRESETS[1],
  nanobanana_2: GEMINI_MODEL_PRESETS[2],
};

export const OPENAI_MODEL_PRESETS: ProviderModelPreset[] = [
  {
    id: "openai_gpt_image_1_5",
    label: "gpt-image-1.5",
    model: "gpt-image-1.5",
  },
  {
    id: "openai_gpt_image_1",
    label: "gpt-image-1",
    model: "gpt-image-1",
  },
  {
    id: "openai_gpt_image_1_mini",
    label: "gpt-image-1-mini",
    model: "gpt-image-1-mini",
  },
];

export const OPENROUTER_MODEL_PRESETS: ProviderModelPreset[] = [
  {
    id: "openrouter_auto",
    label: "openrouter/auto",
    model: "openrouter/auto",
  },
  {
    id: "openrouter_openai_gpt_5_image",
    label: "openai/gpt-5-image",
    model: "openai/gpt-5-image",
  },
  {
    id: "openrouter_openai_gpt_5_image_mini",
    label: "openai/gpt-5-image-mini",
    model: "openai/gpt-5-image-mini",
  },
  {
    id: "openrouter_google_gemini_3_1_flash_image_preview",
    label: "google/gemini-3.1-flash-image-preview",
    model: "google/gemini-3.1-flash-image-preview",
  },
  {
    id: "openrouter_google_gemini_3_pro_image_preview",
    label: "google/gemini-3-pro-image-preview",
    model: "google/gemini-3-pro-image-preview",
  },
  {
    id: "openrouter_google_gemini_2_5_flash_image",
    label: "google/gemini-2.5-flash-image",
    model: "google/gemini-2.5-flash-image",
  },
];

export function isImageSourceKind(value: string): value is ImageSourceKind {
  return value === "crop" || value === "active_layer" || value === "gallery_item" || value === "uploaded_file";
}

export function getProviderModelPresets(provider: ProviderId): ProviderModelPreset[] {
  if (provider === "gemini") {
    return GEMINI_MODEL_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      model: preset.model,
    }));
  }
  if (provider === "openrouter") {
    return OPENROUTER_MODEL_PRESETS;
  }
  return OPENAI_MODEL_PRESETS;
}

const LEGACY_GEMINI_MODEL_ID_ALIASES: Record<string, string> = {
  "gemini-2.5-flash-image-preview": "gemini-2.5-flash-image",
  "nanobanana-pro": "gemini-3.0-image-preview",
  "nanobanana-2": "gemini-3.1-flash-image-preview",
};

export function normalizeGeminiModelId(model: string): string {
  const normalized = model.trim();
  return LEGACY_GEMINI_MODEL_ID_ALIASES[normalized] ?? normalized;
}

export function resolveGeminiModelPreset(model: string): GeminiModelPresetId {
  const normalized = normalizeGeminiModelId(model);
  for (const preset of GEMINI_MODEL_PRESETS) {
    if (preset.model === normalized) {
      return preset.id;
    }
  }
  return "custom";
}
