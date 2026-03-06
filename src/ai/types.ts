export type ProviderId = "openai" | "gemini" | "openrouter";

export type GenerationMode = "text_to_image" | "image_to_image";

export type ImageSourceKind = "crop" | "active_layer" | "gallery_item" | "uploaded_file";

export interface ImageInput {
  kind: ImageSourceKind;
  blob: Blob;
  mimeType: string;
  name?: string;
}

export interface GenerateRequest {
  provider: ProviderId;
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  imageSource?: ImageInput;
  model: string;
  outputCount: number;
  fallbackProvider?: ProviderId;
}

export interface GeneratedAsset {
  mimeType: string;
  blob: Blob;
  width?: number;
  height?: number;
  thumbDataUrl: string;
}

export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export interface TaskRecord {
  id: string;
  provider: ProviderId;
  mode: GenerationMode;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  fallbackFrom?: ProviderId;
  outputs: GeneratedAsset[];
  outputFiles: string[];
  imageSourceKind?: ImageSourceKind;
}

export interface ProviderAdapter {
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<GeneratedAsset[]>;
}

export interface ProviderAdapterMap {
  openai: ProviderAdapter;
  gemini: ProviderAdapter;
  openrouter: ProviderAdapter;
}

export interface RunWithFallbackResult {
  assets: GeneratedAsset[];
  providerUsed: ProviderId;
  fallbackFrom: ProviderId | null;
}

export interface AiSettings {
  activeProvider: ProviderId;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  geminiApiKey: string;
  geminiBaseUrl: string;
  geminiModel: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  openrouterModel: string;
  enableFallback: boolean;
  fallbackProvider: "" | ProviderId;
  outputCount: number;
}

export interface GalleryItem {
  id: string;
  taskId: string;
  provider: ProviderId;
  createdAt: number;
  prompt: string;
  asset: GeneratedAsset;
  selectedAsSource: boolean;
  outputFile?: string;
}

export interface PersistedAiState {
  tasks: TaskRecord[];
  gallery: GalleryItem[];
}
